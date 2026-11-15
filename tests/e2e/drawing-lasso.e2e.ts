import { reveal } from './drawing-sections';
import { expect, test, type Locator, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { ensureHousehold } from './adult';
import { gotoHydrated } from './hydrated';
import { trackMember } from './cleanup';
import { DB_PATH } from './data-dir';
import { expectTappable } from './tap';

// hub-t27j.6 (J18.20): circle some ink with the Lasso, then move, resize or copy it.

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

type P = [number, number];

/** One pointer gesture on an element: down at the first point, moves, up at the last. Points are client px. */
async function gesture(target: Locator, pts: P[]) {
	await target.evaluate((el, pts) => {
		const fire = (name: string, [x, y]: [number, number]) =>
			el.dispatchEvent(
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
		fire('pointerdown', pts[0]);
		for (const p of pts.slice(1)) fire('pointermove', p);
		fire('pointerup', pts[pts.length - 1]);
	}, pts);
}

/** Fractions of the canvas to client px. */
async function onCanvas(page: Page, pts: P[]): Promise<P[]> {
	const r = (await page.getByTestId('draw-canvas').boundingBox())!;
	return pts.map(([x, y]) => [r.x + x * r.width, r.y + y * r.height]);
}

const ink = async (page: Page, pts: P[]) =>
	gesture(page.getByTestId('draw-canvas'), await onCanvas(page, pts));

const along = (a: P, b: P, n = 8): P[] =>
	Array.from({ length: n + 1 }, (_, i) => [
		a[0] + ((b[0] - a[0]) * i) / n,
		a[1] + ((b[1] - a[1]) * i) / n
	]);

/** Bounding box of the ink (alpha > 0) in canvas pixels. */
const inkBox = (page: Page) =>
	page.getByTestId('draw-canvas').evaluate((c: HTMLCanvasElement) => {
		const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
		let x0 = Infinity;
		let y0 = Infinity;
		let x1 = -1;
		let y1 = -1;
		for (let y = 0; y < c.height; y++)
			for (let x = 0; x < c.width; x++)
				if (d[(y * c.width + x) * 4 + 3] > 0) {
					x0 = Math.min(x0, x);
					y0 = Math.min(y0, y);
					x1 = Math.max(x1, x);
					y1 = Math.max(y1, y);
				}
		return { x0, y0, x1, y1 };
	});

const frame = async (page: Page) =>
	(await page.getByTestId('draw-canvas').getAttribute('data-lasso-frame'))!.split(',').map(Number);

test('lasso: circle ink, move, resize and copy it, each one Undo step, saved and reopened @J18.20', async ({
	page
}, info) => {
	const name = `Kid Lasso ${info.workerIndex}${info.repeatEachIndex}`;
	seedKid(`e2e-lasso-kid-${info.workerIndex}${info.repeatEachIndex}`, name);
	await gotoHydrated(page, '/');
	await page.getByTestId('note-draw').click();
	const canvas = page.getByTestId('draw-canvas');

	// Two scribbles far apart: one on the left to circle, one on the right to leave alone.
	await ink(page, [...along([0.15, 0.3], [0.3, 0.4])]);
	await ink(page, [...along([0.7, 0.7], [0.85, 0.8])]);
	await expect(canvas).toHaveAttribute('data-strokes', '2');
	const start = await inkBox(page);

	const lasso = page.getByTestId('draw-lasso');
	await expectTappable(lasso.locator('xpath=..'), 96);
	await lasso.click();
	await expect(page.getByTestId('draw-options-title')).toHaveText('Lasso');
	await expect(page.getByTestId('draw-lasso-copy')).toBeDisabled();

	// A loop that is drawn but encloses nothing selects nothing, and leaves the ink alone.
	await ink(page, [
		[0.5, 0.1],
		[0.6, 0.1],
		[0.6, 0.2],
		[0.5, 0.2],
		[0.5, 0.1]
	]);
	await expect(canvas).toHaveAttribute('data-lasso', '0');
	await expect(page.getByTestId('draw-lasso-box')).toHaveCount(0);

	// Circle the left stroke only.
	await ink(page, [
		[0.1, 0.2],
		[0.35, 0.2],
		[0.35, 0.5],
		[0.1, 0.5],
		[0.1, 0.2]
	]);
	await expect(canvas).toHaveAttribute('data-lasso', '1');
	await expect(page.getByTestId('draw-lasso-box')).toBeVisible();
	const resize = page.getByTestId('draw-lasso-resize');
	await expectTappable(resize, 96);
	await expectTappable(page.getByTestId('draw-lasso-copy'), 96);
	await expect(canvas).toHaveAttribute('data-strokes', '2');

	// Move: drag inside the box. The left ink moves, the right one stays, one Undo step.
	const f0 = await frame(page);
	const rect = (await canvas.boundingBox())!;
	const mid: P = [rect.x + (f0[0] + f0[2] / 2), rect.y + (f0[1] + f0[3] / 2)];
	await gesture(canvas, along(mid, [mid[0] + 200, mid[1] + 120]));
	const moved = await inkBox(page);
	expect(moved.y0).toBeGreaterThan(start.y0 + 50);
	expect(moved.x1).toBe(start.x1); // the right-hand scribble is still the right-most ink
	expect((await frame(page))[0]).toBeGreaterThan(f0[0] + 100);
	await page.getByTestId('draw-undo').click();
	expect(await inkBox(page)).toEqual(start);
	await expect(canvas).toHaveAttribute('data-lasso', '0');
	await page.getByTestId('draw-redo').click();
	expect((await inkBox(page)).y0).toBe(moved.y0);

	// Circle it again (now lower), then resize with the corner handle: the ink grows, one Undo step.
	await ink(page, [
		[0.1, 0.3],
		[0.55, 0.3],
		[0.55, 0.65],
		[0.1, 0.65],
		[0.1, 0.3]
	]);
	await expect(canvas).toHaveAttribute('data-lasso', '1');
	const f1 = await frame(page);
	const ink1 = await inkBox(page);
	const h = (await resize.boundingBox())!;
	const hc: P = [h.x + h.width / 2, h.y + h.height / 2];
	await gesture(resize, along(hc, [hc[0] + 160, hc[1] + 100]));
	const f2 = await frame(page);
	expect(f2[2]).toBeGreaterThan(f1[2] + 40);
	const ink2 = await inkBox(page);
	expect(Math.abs(ink2.x0 - ink1.x0)).toBeLessThanOrEqual(2); // the ink's top-left stays put
	await page.getByTestId('draw-undo').click();
	await page.getByTestId('draw-redo').click();

	// Copy: a second copy of the selection appears, offset; one Undo step removes it.
	await ink(page, [
		[0.05, 0.25],
		[0.65, 0.25],
		[0.65, 0.95],
		[0.05, 0.95],
		[0.05, 0.25]
	]);
	await expect(canvas).toHaveAttribute('data-lasso', '1');
	await page.getByTestId('draw-lasso-copy').click();
	await expect(canvas).toHaveAttribute('data-strokes', '3');
	await expect(canvas).toHaveAttribute('data-lasso', '1'); // the copy is what is selected now
	await page.getByTestId('draw-undo').click();
	await expect(canvas).toHaveAttribute('data-strokes', '2');
	await page.getByTestId('draw-redo').click();
	await expect(canvas).toHaveAttribute('data-strokes', '3');
	const finalInk = await inkBox(page);

	// Save, reopen: the moved, resized and copied ink comes back as it was.
	await page.getByTestId('draw-save').click();
	await page.getByTestId('draw-author').filter({ hasText: name }).click();
	await expect(page.getByTestId('draw-note')).toHaveText('Saved!');
	await reveal(page, 'draw-clear');
	await page.getByTestId('draw-clear').click();
	await expect(canvas).toHaveAttribute('data-strokes', '0');
	await page.getByTestId('draw-browse').click();
	await page.getByRole('button', { name: `Open drawing by ${name}` }).click();
	await expect(canvas).toHaveAttribute('data-strokes', '3');
	const reopened = await inkBox(page);
	for (const k of ['x0', 'y0', 'x1', 'y1'] as const)
		expect(Math.abs(reopened[k] - finalInk[k])).toBeLessThanOrEqual(2);

	await page.getByTestId('draw-browse').click();
	await page.getByRole('button', { name: `Delete drawing by ${name}` }).click();
	await expect(page.getByRole('button', { name: `Open drawing by ${name}` })).toHaveCount(0);
});

test('lasso: the rail and its controls fit the 4K wall screen @J18.20', async ({ page }) => {
	await gotoHydrated(page, '/');
	await page.getByTestId('note-draw').click();
	await page.getByTestId('draw-lasso').click();
	const wall = page.viewportSize();
	await page.setViewportSize({ width: 3840, height: 2160 });
	const panel = (await page.getByTestId('draw-panel').boundingBox())!;
	const copy = (await page.getByTestId('draw-lasso-copy').boundingBox())!;
	expect(copy.x + copy.width).toBeLessThanOrEqual(panel.x + panel.width);
	const rail = page.getByTestId('draw-rail');
	expect(await rail.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
	await expectTappable(page.getByTestId('draw-rail-lasso'), 96);
	if (wall) await page.setViewportSize(wall);
});
