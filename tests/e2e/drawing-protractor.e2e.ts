import { expect, test, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { ensureHousehold } from './adult';
import { gotoHydrated } from './hydrated';
import { expectTappable } from './tap';
import { trackMember } from './cleanup';
import { DB_PATH } from './data-dir';
import { reveal } from './drawing-sections';

// hub-t27j.24: the protractor overlay. A stroke from its center snaps to a 15 degree ray; it is never ink.

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

const proto = (page: Page) => page.getByTestId('draw-protractor');

test('a protractor snaps strokes from its center to 15 degrees, moves, turns, and is never ink @J18.37', async ({
	page
}, info) => {
	const kidId = `e2e-protractor-kid-${info.workerIndex}${info.repeatEachIndex}`;
	seedKid(kidId, 'Kid Protractor');
	await gotoHydrated(page, '/');
	await page.getByTestId('note-draw').click();
	await reveal(page, 'draw-protractor-toggle');
	const toggle = page.getByTestId('draw-protractor-toggle');
	await expectTappable(toggle, 96);
	await expect(proto(page)).toHaveCount(0);

	await toggle.click();
	await expect(proto(page)).toBeVisible();
	await expectTappable(page.getByTestId('draw-protractor-move'), 96);
	await expectTappable(page.getByTestId('draw-protractor-turn'), 96);
	await expect(proto(page).getByText('90', { exact: true })).toHaveCount(1);
	await expect(page.getByTestId('draw-canvas')).toHaveAttribute('data-strokes', '0');

	// A shaky stroke from near the center, aimed about 20 degrees above flat, comes out at exactly 15.
	const box = (await page.getByTestId('draw-canvas').boundingBox())!;
	const cx = box.x + Number(await proto(page).getAttribute('data-cx'));
	const cy = box.y + Number(await proto(page).getAttribute('data-cy'));
	const aim = (20 * Math.PI) / 180;
	await wobble(page, [cx + 30, cy + 10], [cx + Math.cos(aim) * 500, cy - Math.sin(aim) * 500]);
	await expect(page.getByTestId('draw-canvas')).toHaveAttribute('data-strokes', '1');
	const snapped = await inkBox(page);
	// 15 degrees: height is about tan(15) of the width, with no wobble.
	expect(snapped.h / snapped.w).toBeGreaterThan(0.2);
	expect(snapped.h / snapped.w).toBeLessThan(0.34);
	await page.getByTestId('draw-undo').click();
	await expect(proto(page)).toBeVisible(); // undo never touches the protractor

	// A stroke far from the center is not touched.
	await wobble(page, [box.x + 200, box.y + 100], [box.x + 600, box.y + 100]);
	expect((await inkBox(page)).h).toBeGreaterThan(40);
	await page.getByTestId('draw-undo').click();

	// Drag the grip: it moves.
	const cx0 = Number(await proto(page).getAttribute('data-cx'));
	const grip = (await page.getByTestId('draw-protractor-move').boundingBox())!;
	const gx = grip.x + grip.width / 2;
	const gy = grip.y + grip.height / 2;
	await page.mouse.move(gx, gy);
	await page.mouse.down();
	await page.mouse.move(gx + 100, gy - 50, { steps: 4 });
	await page.mouse.up();
	expect(Number(await proto(page).getAttribute('data-cx'))).toBeCloseTo(cx0 + 100, 0);

	// Drag the turn handle straight below the center: the protractor flips upside down.
	const turn = (await page.getByTestId('draw-protractor-turn').boundingBox())!;
	const cxs = Number(await proto(page).getAttribute('data-cx')) + box.x;
	const cys = Number(await proto(page).getAttribute('data-cy')) + box.y;
	await page.mouse.move(turn.x + turn.width / 2, turn.y + turn.height / 2);
	await page.mouse.down();
	await page.mouse.move(cxs, cys + 200, { steps: 6 });
	await page.mouse.up();
	expect(Number(await proto(page).getAttribute('data-angle'))).toBeCloseTo(Math.PI / 2, 1);

	// Ruler and Protractor are exclusive.
	await reveal(page, 'draw-ruler-toggle');
	await page.getByTestId('draw-ruler-toggle').click();
	await expect(proto(page)).toHaveCount(0);
	await expect(page.getByTestId('draw-ruler')).toBeVisible();
	await toggle.click();
	await expect(page.getByTestId('draw-ruler')).toHaveCount(0);
	await expect(proto(page)).toBeVisible();

	// Off: it goes away and nothing was saved as ink.
	await toggle.click();
	await expect(proto(page)).toHaveCount(0);
	await expect(page.getByTestId('draw-canvas')).toHaveAttribute('data-blank', 'true');
});

test('the protractor and its handles fit on the 4K wall screen', async ({ page }, info) => {
	const kidId = `e2e-protractor-4k-${info.workerIndex}${info.repeatEachIndex}`;
	seedKid(kidId, 'Kid Protractor 4K');
	await page.setViewportSize({ width: 3840, height: 2160 });
	await gotoHydrated(page, '/');
	await page.getByTestId('note-draw').click();
	await reveal(page, 'draw-protractor-toggle');
	await page.getByTestId('draw-protractor-toggle').click();
	const holder = (await page.getByTestId('draw-holder').boundingBox())!;
	for (const id of ['draw-protractor-move', 'draw-protractor-turn']) {
		const b = (await page.getByTestId(id).boundingBox())!;
		expect(b.x).toBeGreaterThanOrEqual(holder.x);
		expect(b.x + b.width).toBeLessThanOrEqual(holder.x + holder.width);
		expect(b.y).toBeGreaterThanOrEqual(holder.y);
		expect(b.y + b.height).toBeLessThanOrEqual(holder.y + holder.height);
	}
});
