import { expect, test, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { ensureHousehold } from './adult';
import { gotoHydrated } from './hydrated';
import { expectTappable } from './tap';
import { trackMember } from './cleanup';
import { DB_PATH } from './data-dir';
import { reveal } from './drawing-sections';

// hub-t27j.16: the ruler overlay. A stroke starting near its edge comes out straight; it is never ink.

function seedKid(id: string, name: string) {
	ensureHousehold();
	const db = new Database(DB_PATH);
	db.pragma('busy_timeout = 5000');
	db.prepare(
		"INSERT OR REPLACE INTO members (id, name, role, color, avatar) VALUES (?, ?, 'child', 'member-3', '🦊')"
	).run(id, name);
	db.close();
	trackMember(id);
}

/** A wobbly pen stroke between two screen points (px), dispatched on the canvas. */
async function wobble(page: Page, from: [number, number], to: [number, number]) {
	await page.getByTestId('draw-canvas').evaluate(
		(c, a) => {
			const fire = (name: string, x: number, y: number) =>
				c.dispatchEvent(
					new PointerEvent(name, {
						pointerId: 1,
						pointerType: 'pen',
						pressure: 0.8,
						isPrimary: true,
						button: 0,
						buttons: name === 'pointerup' ? 0 : 1,
						clientX: x,
						clientY: y,
						bubbles: true
					})
				);
			fire('pointerdown', a.from[0], a.from[1]);
			for (let i = 1; i <= 12; i++) {
				const t = i / 12;
				const w = (i % 2 ? 1 : -1) * 40; // a shaky hand, perpendicular-ish
				fire(
					'pointermove',
					a.from[0] + (a.to[0] - a.from[0]) * t + w,
					a.from[1] + (a.to[1] - a.from[1]) * t + w
				);
			}
			fire('pointerup', a.to[0], a.to[1]);
		},
		{ from, to }
	);
}

/** Size of the ink's bounding box in canvas px. */
const inkBox = (page: Page) =>
	page.getByTestId('draw-canvas').evaluate((c: HTMLCanvasElement) => {
		const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
		let x0 = c.width,
			x1 = -1,
			y0 = c.height,
			y1 = -1;
		for (let y = 0; y < c.height; y++)
			for (let x = 0; x < c.width; x++)
				if (d[(y * c.width + x) * 4 + 3] > 0) {
					x0 = Math.min(x0, x);
					x1 = Math.max(x1, x);
					y0 = Math.min(y0, y);
					y1 = Math.max(y1, y);
				}
		return { w: x1 - x0 + 1, h: y1 - y0 + 1 };
	});

const ruler = (page: Page) => page.getByTestId('draw-ruler');

/** The ruler's long edge in screen px: where a stroke has to start to snap. */
async function edgeY(page: Page): Promise<{ x: number; y: number }> {
	const box = await page.getByTestId('draw-canvas').boundingBox();
	const cx = Number(await ruler(page).getAttribute('data-cx'));
	const cy = Number(await ruler(page).getAttribute('data-cy'));
	return { x: box!.x + cx - 300, y: box!.y + cy - 80 }; // thick 160: top edge is 80 above center
}

test('a ruler straightens strokes along its edge, moves and turns, and is never ink @J18.34', async ({
	page
}, info) => {
	const kidId = `e2e-ruler-kid-${info.workerIndex}${info.repeatEachIndex}`;
	seedKid(kidId, 'Kid Ruler');
	await gotoHydrated(page, '/');
	await page.getByTestId('note-draw').click();
	await reveal(page, 'draw-ruler-toggle');
	const toggle = page.getByTestId('draw-ruler-toggle');
	await expectTappable(toggle, 96);
	await expect(ruler(page)).toHaveCount(0);

	// Without the ruler a shaky stroke stays shaky.
	const box = (await page.getByTestId('draw-canvas').boundingBox())!;
	await wobble(page, [box.x + 200, box.y + 200], [box.x + 600, box.y + 200]);
	expect((await inkBox(page)).h).toBeGreaterThan(40);
	await page.getByTestId('draw-undo').click();

	await toggle.click();
	await expect(ruler(page)).toBeVisible();
	await expectTappable(page.getByTestId('draw-ruler-move'), 96);
	await expectTappable(page.getByTestId('draw-ruler-turn'), 96);
	await expect(page.getByTestId('draw-canvas')).toHaveAttribute('data-strokes', '0');

	// Starting by the edge: straight as a ruler along the whole stroke.
	const e = await edgeY(page);
	await wobble(page, [e.x, e.y - 20], [e.x + 500, e.y - 20]);
	await expect(page.getByTestId('draw-canvas')).toHaveAttribute('data-strokes', '1');
	const straight = await inkBox(page);
	expect(straight.h).toBeLessThan(40);
	expect(straight.w).toBeGreaterThan(300);

	// Away from the ruler the stroke is untouched.
	await wobble(page, [box.x + 200, box.y + 60], [box.x + 600, box.y + 60]);
	expect((await inkBox(page)).h).toBeGreaterThan(straight.h + 40);
	await page.getByTestId('draw-undo').click();
	await page.getByTestId('draw-undo').click();
	await expect(page.getByTestId('draw-canvas')).toHaveAttribute('data-strokes', '0');
	await expect(ruler(page)).toBeVisible(); // undo never touches the ruler

	// Drag the grip: the ruler moves.
	const cx0 = Number(await ruler(page).getAttribute('data-cx'));
	const grip = (await page.getByTestId('draw-ruler-move').boundingBox())!;
	const gx = grip.x + grip.width / 2;
	const gy = grip.y + grip.height / 2;
	await page.mouse.move(gx, gy);
	await page.mouse.down();
	await page.mouse.move(gx - 100, gy + 50, { steps: 4 });
	await page.mouse.up();
	expect(Number(await ruler(page).getAttribute('data-cx'))).toBeCloseTo(cx0 - 100, 0);

	// Drag the turn handle straight below the center: the ruler stands upright.
	const turn = (await page.getByTestId('draw-ruler-turn').boundingBox())!;
	const cxs = Number(await ruler(page).getAttribute('data-cx')) + box.x;
	const cys = Number(await ruler(page).getAttribute('data-cy')) + box.y;
	await page.mouse.move(turn.x + turn.width / 2, turn.y + turn.height / 2);
	await page.mouse.down();
	await page.mouse.move(cxs, cys + 200, { steps: 6 });
	await page.mouse.up();
	expect(Number(await ruler(page).getAttribute('data-angle'))).toBeCloseTo(Math.PI / 2, 1);

	// Now a diagonal-ish shaky stroke down the vertical edge comes out vertical.
	await page.getByTestId('draw-canvas').evaluate((c) => c.scrollIntoView());
	const right = { x: cxs + 80 + 20, y: cys - 300 };
	await wobble(page, [right.x, right.y], [right.x, right.y + 500]);
	const upright = await inkBox(page);
	expect(upright.w).toBeLessThan(40);
	expect(upright.h).toBeGreaterThan(300);
	await page.getByTestId('draw-undo').click();

	// Off: the ruler goes away and nothing was saved as ink.
	await toggle.click();
	await expect(ruler(page)).toHaveCount(0);
	await expect(page.getByTestId('draw-canvas')).toHaveAttribute('data-blank', 'true');
});

test('the ruler and its handles fit on the 4K wall screen', async ({ page }, info) => {
	const kidId = `e2e-ruler-4k-${info.workerIndex}${info.repeatEachIndex}`;
	seedKid(kidId, 'Kid Ruler 4K');
	await page.setViewportSize({ width: 3840, height: 2160 });
	await gotoHydrated(page, '/');
	await page.getByTestId('note-draw').click();
	await reveal(page, 'draw-ruler-toggle');
	await page.getByTestId('draw-ruler-toggle').click();
	const holder = (await page.getByTestId('draw-holder').boundingBox())!;
	for (const id of ['draw-ruler-move', 'draw-ruler-turn']) {
		const b = (await page.getByTestId(id).boundingBox())!;
		expect(b.x).toBeGreaterThanOrEqual(holder.x);
		expect(b.x + b.width).toBeLessThanOrEqual(holder.x + holder.width);
		expect(b.y).toBeGreaterThanOrEqual(holder.y);
		expect(b.y + b.height).toBeLessThanOrEqual(holder.y + holder.height);
	}
});
