import { expect, test, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensureHousehold, signInAsAdult } from './adult';
import { gotoHydrated } from './hydrated';
import { expectTappable } from './tap';
import { trackMember } from './cleanup';
import { DATA_DIR, DB_PATH } from './data-dir';
import { ALL_SHAPES } from '../../src/lib/domain/drawing';
import { syntheticJpeg } from '../../src/lib/server/photo-cache/fixtures';

// hub-fkp: the drawing board posts a PNG note. Runs in both wall orientations.

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

function wipe(authorId: string) {
	const db = new Database(DB_PATH);
	db.pragma('busy_timeout = 5000');
	db.prepare('DELETE FROM notes WHERE author_id = ?').run(authorId);
	db.prepare('DELETE FROM saved_drawings WHERE member_id = ?').run(authorId);
	db.close();
}

/** Opaque pixels on the canvas (it starts fully transparent over a paper-colored backdrop). */
const inkPixels = (page: Page) =>
	page.getByTestId('draw-canvas').evaluate((c: HTMLCanvasElement) => {
		const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
		let n = 0;
		for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
		return n;
	});

/** A pointer event stream on the canvas, like a pen or a finger would send. */
async function pointerStroke(
	page: Page,
	type: string,
	pressure: number,
	from: [number, number],
	to: [number, number],
	id: number
) {
	await page.getByTestId('draw-canvas').evaluate(
		(c, a) => {
			const r = c.getBoundingClientRect();
			const fire = (name: string, x: number, y: number) =>
				c.dispatchEvent(
					new PointerEvent(name, {
						pointerId: a.id,
						pointerType: a.type,
						pressure: a.pressure,
						isPrimary: true,
						button: 0,
						buttons: name === 'pointerup' ? 0 : 1,
						clientX: r.left + x * r.width,
						clientY: r.top + y * r.height,
						bubbles: true
					})
				);
			fire('pointerdown', a.from[0], a.from[1]);
			for (let i = 1; i <= 8; i++)
				fire(
					'pointermove',
					a.from[0] + ((a.to[0] - a.from[0]) * i) / 8,
					a.from[1] + ((a.to[1] - a.from[1]) * i) / 8
				);
			fire('pointerup', a.to[0], a.to[1]);
		},
		{ type, pressure, from, to, id }
	);
}

test('draw with a pen, ignore a palm, undo, post, enlarge and dismiss @J18.1 @J18.2', async ({
	page
}, info) => {
	const tag = `d${Date.now().toString(36)}${info.workerIndex}${info.repeatEachIndex}`;
	const kidId = `e2e-draw-kid-${tag}`;
	const kidName = `Kid ${tag}`;
	seedKid(kidId, kidName);
	try {
		await gotoHydrated(page, '/');
		await page.getByTestId('note-draw').click();
		await expect(page.getByTestId('draw-sheet')).toBeVisible();
		await expect(page.getByTestId('draw-post')).toBeDisabled();
		expect(await inkPixels(page)).toBe(0);

		// Sized for the device pixel ratio.
		const sizes = await page.getByTestId('draw-canvas').evaluate((c: HTMLCanvasElement) => ({
			backing: c.width,
			css: c.getBoundingClientRect().width,
			dpr: window.devicePixelRatio
		}));
		expect(Math.abs(sizes.backing - sizes.css * sizes.dpr)).toBeLessThanOrEqual(1);

		await expectTappable(page.getByTestId('draw-eraser'), 96);
		await expectTappable(page.getByTestId('draw-undo'), 96);
		await expectTappable(page.getByTestId('draw-color').first(), 96);

		// A pen stroke with pressure leaves ink.
		await page.getByTestId('draw-color').nth(4).click();
		await pointerStroke(page, 'pen', 0.9, [0.1, 0.2], [0.8, 0.3], 1);
		await expect(page.getByTestId('draw-canvas')).toHaveAttribute('data-strokes', '1');
		const penInk = await inkPixels(page);
		expect(penInk).toBeGreaterThan(200);

		// Palm rejection: touch is ignored now that a pen has been seen.
		await pointerStroke(page, 'touch', 0.5, [0.1, 0.8], [0.8, 0.9], 2);
		await expect(page.getByTestId('draw-canvas')).toHaveAttribute('data-strokes', '1');
		expect(await inkPixels(page)).toBe(penInk);

		// A second pen stroke, then undo takes it back.
		await pointerStroke(page, 'pen', 0.3, [0.2, 0.6], [0.7, 0.7], 3);
		await expect(page.getByTestId('draw-canvas')).toHaveAttribute('data-strokes', '2');
		expect(await inkPixels(page)).toBeGreaterThan(penInk);
		await page.getByTestId('draw-undo').click();
		await expect(page.getByTestId('draw-canvas')).toHaveAttribute('data-strokes', '1');
		expect(await inkPixels(page)).toBe(penInk);

		// The eraser removes ink.
		await page.getByTestId('draw-eraser').click();
		await pointerStroke(page, 'pen', 1, [0.1, 0.2], [0.8, 0.3], 4);
		expect(await inkPixels(page)).toBeLessThan(penInk);
		await page.getByTestId('draw-undo').click();

		// Post it as the kid.
		await page.getByTestId('draw-post').click();
		await page.getByTestId('draw-author').filter({ hasText: kidName }).click();
		await expect(page.getByTestId('draw-sheet')).toHaveCount(0);

		const thumb = page.getByTestId('note').filter({ hasText: kidName }).getByTestId('note-image');
		await expect(thumb).toHaveCount(1);
		await expect(thumb.locator('img')).toBeVisible();

		// It reached the server as a small PNG, and survives a reload.
		await gotoHydrated(page, '/');
		await expect(thumb).toHaveCount(1);
		const notes = (await (await page.request.get('/api/notes')).json()) as {
			authorId: string;
			imageUrl: string | null;
		}[];
		const mine = notes.find((n) => n.authorId === kidId)!;
		const png = await page.request.get(mine.imageUrl!);
		expect(png.headers()['content-type']).toBe('image/png');
		const bytes = (await png.body()).length;
		expect(bytes).toBeGreaterThan(100);
		expect(bytes).toBeLessThanOrEqual(300_000);

		// Tap to enlarge, close, then dismiss.
		await thumb.click();
		await expect(page.getByTestId('note-zoom')).toBeVisible();
		await page.getByTestId('note-zoom-close').click();
		await expect(page.getByTestId('note-zoom')).toHaveCount(0);
		await page.getByTestId('note').filter({ hasText: kidName }).getByTestId('note-dismiss').click();
		await expect(thumb).toHaveCount(0);
		await expect.poll(async () => (await page.request.get(mine.imageUrl!)).status()).toBe(404);
	} finally {
		wipe(kidId);
	}
});

test('a finger draws when no pen is around @J18.1', async ({ page }, info) => {
	const kidId = `e2e-draw-kid2-${info.workerIndex}${info.repeatEachIndex}`;
	seedKid(kidId, 'Kid Finger');
	try {
		await gotoHydrated(page, '/');
		await page.getByTestId('note-draw').click();
		await pointerStroke(page, 'touch', 0, [0.2, 0.2], [0.6, 0.6], 1);
		await expect(page.getByTestId('draw-canvas')).toHaveAttribute('data-blank', 'false');
		expect(await inkPixels(page)).toBeGreaterThan(200);
		await page.getByTestId('draw-clear').click();
		expect(await inkPixels(page)).toBe(0);
		await page.getByTestId('draw-close').click();
		await expect(page.getByTestId('draw-sheet')).toHaveCount(0);
	} finally {
		wipe(kidId);
	}
});

/** Largest alpha on the canvas (a highlighter leaves translucent ink). */
const maxAlpha = (page: Page) =>
	page.getByTestId('draw-canvas').evaluate((c: HTMLCanvasElement) => {
		const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
		let m = 0;
		for (let i = 3; i < d.length; i += 4) m = Math.max(m, d[i]);
		return m;
	});

test('more colors, recent colors, brush sizes and the highlighter @J18.3', async ({
	page
}, info) => {
	const kidId = `e2e-draw-kid3-${info.workerIndex}${info.repeatEachIndex}`;
	seedKid(kidId, 'Kid Colors');
	try {
		await gotoHydrated(page, '/');
		await page.getByTestId('note-draw').click();
		await expect(page.getByTestId('draw-recent')).toHaveCount(0);

		await expectTappable(page.getByTestId('draw-more-colors'), 96);
		await expectTappable(page.getByTestId('draw-size').first(), 96);
		await expectTappable(page.getByTestId('draw-highlighter'), 96);

		// The grid opens from More colors, swatches are big, and picking one closes it.
		await page.getByTestId('draw-more-colors').click();
		await expect(page.getByTestId('draw-grid')).toBeVisible();
		await expectTappable(page.getByTestId('draw-grid-color').first(), 96);
		await page.getByTestId('draw-grid-color').nth(10).click();
		await expect(page.getByTestId('draw-grid')).toHaveCount(0);

		// Thin vs marker with the same pen pressure: the marker leaves more ink.
		await page.getByTestId('draw-size').first().click(); // thin
		await pointerStroke(page, 'pen', 0.6, [0.1, 0.2], [0.8, 0.2], 1);
		const thin = await inkPixels(page);
		await page.getByTestId('draw-clear').click();
		await page.getByTestId('draw-size').last().click(); // marker
		await pointerStroke(page, 'pen', 0.6, [0.1, 0.2], [0.8, 0.2], 2);
		expect(await inkPixels(page)).toBeGreaterThan(thin * 2);
		expect(await maxAlpha(page)).toBe(255);

		// The grid color is now a recent color; picking another ink adds to the row.
		await expect(page.getByTestId('draw-recent')).toHaveCount(1);
		await page.getByTestId('draw-color').nth(1).click();
		await page.getByTestId('draw-clear').click();
		await pointerStroke(page, 'pen', 0.6, [0.1, 0.4], [0.8, 0.4], 3);
		await expect(page.getByTestId('draw-recent')).toHaveCount(2);
		await page.getByTestId('draw-recent').nth(1).click();
		await expect(page.getByTestId('draw-recent').nth(1)).toBeVisible();

		// The highlighter is translucent.
		await page.getByTestId('draw-clear').click();
		await page.getByTestId('draw-highlighter').click();
		await pointerStroke(page, 'pen', 1, [0.1, 0.6], [0.8, 0.6], 4);
		await expect(page.getByTestId('draw-canvas')).toHaveAttribute('data-blank', 'false');
		const alpha = await maxAlpha(page);
		expect(alpha).toBeGreaterThan(0);
		expect(alpha).toBeLessThan(200);
	} finally {
		wipe(kidId);
	}
});

test('insert shapes and stamps, outline or filled, undo @J18.4', async ({ page }, info) => {
	const kidId = `e2e-draw-kid4-${info.workerIndex}${info.repeatEachIndex}`;
	seedKid(kidId, 'Kid Shapes');
	try {
		await gotoHydrated(page, '/');
		await page.getByTestId('note-draw').click();
		const canvas = page.getByTestId('draw-canvas');
		await expectTappable(page.getByTestId('draw-shapes-open'), 96);
		await page.getByTestId('draw-shapes-open').click();
		await expect(page.getByTestId('draw-shape')).toHaveCount(ALL_SHAPES.length);
		await expectTappable(page.getByTestId('draw-shape').first(), 96);

		// An outlined square dragged out leaves ink and counts as one undoable item.
		await page.getByTestId('draw-shape').and(page.locator('[data-shape="square"]')).click();
		await expect(page.getByTestId('draw-shape')).toHaveCount(0);
		await pointerStroke(page, 'touch', 0.5, [0.2, 0.2], [0.6, 0.6], 1);
		await expect(canvas).toHaveAttribute('data-strokes', '1');
		await expect(canvas).toHaveAttribute('data-blank', 'false');
		const outline = await inkPixels(page);
		expect(outline).toBeGreaterThan(200);
		await page.getByTestId('draw-undo').click();
		await expect(canvas).toHaveAttribute('data-strokes', '0');
		expect(await inkPixels(page)).toBe(0);

		// The same square filled covers far more.
		await page.getByTestId('draw-shapes-open').click();
		await page.getByTestId('draw-fill').and(page.locator('[data-filled="true"]')).click();
		await page.getByTestId('draw-shape').and(page.locator('[data-shape="square"]')).click();
		await pointerStroke(page, 'touch', 0.5, [0.2, 0.2], [0.6, 0.6], 2);
		expect(await inkPixels(page)).toBeGreaterThan(outline * 2);

		// A stamp places on a plain drag, alongside the square.
		await page.getByTestId('draw-shapes-open').click();
		await page.getByTestId('draw-shape').and(page.locator('[data-shape="smiley"]')).click();
		await pointerStroke(page, 'touch', 0.5, [0.65, 0.5], [0.95, 0.9], 3);
		await expect(canvas).toHaveAttribute('data-strokes', '2');

		// Shapes are part of the drawing: posting works, and going back to the pen draws freehand.
		await page.getByTestId('draw-shapes-open').click();
		await page.getByTestId('draw-shape-off').click();
		await pointerStroke(page, 'touch', 0.5, [0.1, 0.9], [0.5, 0.95], 4);
		await expect(canvas).toHaveAttribute('data-strokes', '3');
		await expect(page.getByTestId('draw-post')).toBeEnabled();
		await page.getByTestId('draw-close').click();
	} finally {
		wipe(kidId);
	}
});

test('paint bucket fills a closed shape and undo takes it back @J18.5', async ({ page }, info) => {
	const kidId = `e2e-draw-kid5-${info.workerIndex}${info.repeatEachIndex}`;
	seedKid(kidId, 'Kid Bucket');
	try {
		await gotoHydrated(page, '/');
		await page.getByTestId('note-draw').click();
		const canvas = page.getByTestId('draw-canvas');

		// Outline a square, then switch to the bucket.
		await page.getByTestId('draw-shapes-open').click();
		await page.getByTestId('draw-shape').and(page.locator('[data-shape="square"]')).click();
		await pointerStroke(page, 'touch', 0.5, [0.2, 0.2], [0.6, 0.6], 1);
		const outline = await inkPixels(page);
		await expectTappable(page.getByTestId('draw-bucket'), 96);
		await page.getByTestId('draw-bucket').click();
		await expect(page.getByTestId('draw-bucket')).toHaveAttribute('aria-pressed', 'true');

		// Tapping inside fills only the inside: more ink, but far from the whole canvas.
		await page.getByTestId('draw-color').and(page.locator('[data-color="draw-red"]')).click();
		await pointerStroke(page, 'touch', 0.5, [0.4, 0.4], [0.4, 0.4], 2);
		await expect(canvas).toHaveAttribute('data-strokes', '2');
		const inside = await inkPixels(page);
		expect(inside).toBeGreaterThan(outline * 2);
		const total = await canvas.evaluate((c: HTMLCanvasElement) => c.width * c.height);
		expect(inside).toBeLessThan(total / 2);

		// Tapping outside floods the rest of the page.
		await pointerStroke(page, 'touch', 0.5, [0.9, 0.9], [0.9, 0.9], 3);
		expect(await inkPixels(page)).toBeGreaterThan(total * 0.9);

		// Each fill is one undo step.
		await page.getByTestId('draw-undo').click();
		expect(await inkPixels(page)).toBe(inside);
		await page.getByTestId('draw-undo').click();
		expect(await inkPixels(page)).toBe(outline);
		await page.getByTestId('draw-close').click();
	} finally {
		wipe(kidId);
	}
});

test('save a drawing, reopen it from My drawings, delete it @J18.6', async ({ page }, info) => {
	const kidId = `e2e-draw-kid6-${info.workerIndex}${info.repeatEachIndex}`;
	const name = `Kid Saver ${info.workerIndex}${info.repeatEachIndex}`;
	seedKid(kidId, name);
	try {
		await gotoHydrated(page, '/');
		await page.getByTestId('note-draw').click();
		const canvas = page.getByTestId('draw-canvas');
		await expect(page.getByTestId('draw-save')).toBeDisabled();
		await pointerStroke(page, 'touch', 0.5, [0.1, 0.3], [0.8, 0.6], 1);
		const ink = await inkPixels(page);
		await expectTappable(page.getByTestId('draw-save'), 96);
		await expectTappable(page.getByTestId('draw-browse'), 96);

		// Save as the kid; the board says so at once.
		await page.getByTestId('draw-save').click();
		await page.getByTestId('draw-author').filter({ hasText: name }).click();
		await expect(page.getByTestId('draw-note')).toHaveText('Saved!');

		// Clear the board, then open it again from My drawings.
		await page.getByTestId('draw-clear').click();
		expect(await inkPixels(page)).toBe(0);
		await page.getByTestId('draw-browse').click();
		const mine = page.getByRole('button', { name: `Open drawing by ${name}` });
		await expect(mine).toHaveCount(1);
		await expectTappable(mine, 96);
		await expectTappable(page.getByRole('button', { name: `Delete drawing by ${name}` }), 96);
		await mine.click();
		await expect(canvas).toHaveAttribute('data-strokes', '1');
		expect(await inkPixels(page)).toBeGreaterThan(ink / 2);

		// Saving the reopened drawing again overwrites it rather than adding a second.
		await page.getByTestId('draw-save').click();
		await expect(page.getByTestId('draw-note')).toHaveText('Saved!');
		await page.getByTestId('draw-browse').click();
		await expect(page.getByRole('button', { name: `Open drawing by ${name}` })).toHaveCount(1);

		// Delete it.
		await page.getByRole('button', { name: `Delete drawing by ${name}` }).click();
		await expect(page.getByRole('button', { name: `Open drawing by ${name}` })).toHaveCount(0);
		await page.getByTestId('draw-mine-close').click();
		await page.getByTestId('draw-close').click();
	} finally {
		wipe(kidId);
	}
});

/**
 * Opaque pixels on the coloring page's line layer. Picking a page closes the picker, which
 * resizes the board; the ResizeObserver then refits and redraws the lines a frame later. Wait
 * until the layer matches the board's laid-out size, so the count is never from a stale size.
 */
const lineInk = async (page: Page) => {
	const lines = page.getByTestId('draw-lines');
	await expect
		.poll(() =>
			lines.evaluate((c: HTMLCanvasElement) => {
				const box = c.parentElement!;
				const dpr = window.devicePixelRatio || 1;
				return (
					c.width === Math.max(1, Math.round(box.clientWidth * dpr)) &&
					c.height === Math.max(1, Math.round(box.clientHeight * dpr))
				);
			})
		)
		.toBe(true);
	return lines.evaluate((c: HTMLCanvasElement) => {
		const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
		let n = 0;
		for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
		return n;
	});
};

/** The canvas fraction of a point on the 1000 x 700 coloring page (fitted and centred). */
const pageSpot = (page: Page, x: number, y: number) =>
	page.getByTestId('draw-canvas').evaluate(
		(c, p) => {
			const r = c.getBoundingClientRect();
			const s = Math.min(r.width / 1000, r.height / 700);
			return [
				((r.width - 1000 * s) / 2 + p.x * s) / r.width,
				((r.height - 700 * s) / 2 + p.y * s) / r.height
			] as [number, number];
		},
		{ x, y }
	);

test('coloring page: lines stay, fill stops at them, saves with its page @J18.7', async ({
	page
}, info) => {
	const kidId = `e2e-draw-kid7-${info.workerIndex}${info.repeatEachIndex}`;
	const name = `Kid Colorer ${info.workerIndex}${info.repeatEachIndex}`;
	seedKid(kidId, name);
	try {
		await gotoHydrated(page, '/');
		await page.getByTestId('note-draw').click();
		const canvas = page.getByTestId('draw-canvas');
		await expectTappable(page.getByTestId('draw-pages-open'), 96);
		await page.getByTestId('draw-pages-open').click();
		await expect(page.getByTestId('draw-page')).toHaveCount(4);
		await expectTappable(page.getByTestId('draw-page').first(), 96);
		await page.getByTestId('draw-page').and(page.locator('[data-page="house"]')).click();
		await expect(canvas).toHaveAttribute('data-page', 'house');
		const lines = await lineInk(page);
		expect(lines).toBeGreaterThan(2000);
		// A page alone is not a drawing yet, and the ink layer is empty.
		await expect(canvas).toHaveAttribute('data-blank', 'true');
		expect(await inkPixels(page)).toBe(0);

		// The eraser cannot rub the lines out.
		await page.getByTestId('draw-eraser').click();
		await pointerStroke(page, 'touch', 0.5, [0.1, 0.5], [0.9, 0.5], 1);
		expect(await lineInk(page)).toBe(lines);
		await page.getByTestId('draw-eraser').click();

		// Fill the door: the color stays inside its lines.
		await page.getByTestId('draw-bucket').click();
		await page.getByTestId('draw-color').and(page.locator('[data-color="draw-red"]')).click();
		const door = await pageSpot(page, 500, 500);
		await pointerStroke(page, 'touch', 0.5, door, door, 2);
		await expect(canvas).toHaveAttribute('data-blank', 'false');
		const painted = await inkPixels(page);
		const total = await canvas.evaluate((c: HTMLCanvasElement) => c.width * c.height);
		expect(painted).toBeGreaterThan(total * 0.01);
		expect(painted).toBeLessThan(total * 0.1);

		// Save it, switch to a blank page, and reopen: the page and the color come back.
		await page.getByTestId('draw-save').click();
		await page.getByTestId('draw-author').filter({ hasText: name }).click();
		await expect(page.getByTestId('draw-note')).toHaveText('Saved!');
		await page.getByTestId('draw-pages-open').click();
		await page.getByTestId('draw-page-none').click();
		await expect(canvas).toHaveAttribute('data-page', '');
		expect(await lineInk(page)).toBe(0);
		await page.getByTestId('draw-browse').click();
		await page.getByRole('button', { name: `Open drawing by ${name}` }).click();
		await expect(canvas).toHaveAttribute('data-page', 'house');
		expect(await lineInk(page)).toBe(lines);
		await expect.poll(() => inkPixels(page)).toBeGreaterThan(painted * 0.8);
		await page.getByTestId('draw-close').click();
	} finally {
		wipe(kidId);
	}
});

/** The box (CSS px, relative to the canvas) around every opaque pixel, or null when blank. */
const inkBox = (page: Page) =>
	page.getByTestId('draw-canvas').evaluate((c: HTMLCanvasElement) => {
		const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
		const k = c.width / c.getBoundingClientRect().width;
		let x0 = Infinity;
		let y0 = Infinity;
		let x1 = -1;
		let y1 = -1;
		for (let y = 0; y < c.height; y++)
			for (let x = 0; x < c.width; x++)
				if (d[(y * c.width + x) * 4 + 3] > 0) {
					x0 = Math.min(x0, x);
					x1 = Math.max(x1, x);
					y0 = Math.min(y0, y);
					y1 = Math.max(y1, y);
				}
		return x1 < 0 ? null : { x0: x0 / k, y0: y0 / k, w: (x1 - x0) / k, h: (y1 - y0) / k };
	});

/** Drag a handle's centre to a point (CSS px relative to the canvas), like a finger would. */
async function dragHandle(
	page: Page,
	which: 'resize' | 'rotate',
	to: [number, number],
	id: number
) {
	const handle = page.locator(`[data-testid="draw-handle"][data-handle="${which}"]`);
	const cr = (await page.getByTestId('draw-canvas').boundingBox())!;
	await handle.evaluate(
		(el, a) => {
			const r = el.getBoundingClientRect();
			const fire = (name: string, x: number, y: number) =>
				el.dispatchEvent(
					new PointerEvent(name, {
						pointerId: a.id,
						pointerType: 'touch',
						isPrimary: true,
						button: 0,
						buttons: name === 'pointerup' ? 0 : 1,
						clientX: x,
						clientY: y,
						bubbles: true
					})
				);
			const x0 = r.left + r.width / 2;
			const y0 = r.top + r.height / 2;
			const x1 = a.cr.x + a.to[0];
			const y1 = a.cr.y + a.to[1];
			fire('pointerdown', x0, y0);
			for (let i = 1; i <= 8; i++)
				fire('pointermove', x0 + ((x1 - x0) * i) / 8, y0 + ((y1 - y0) * i) / 8);
			fire('pointerup', x1, y1);
		},
		{ to, cr, id }
	);
}

test('move, resize and turn a placed shape before it is committed @J18.8', async ({
	page
}, info) => {
	const kidId = `e2e-draw-kid8-${info.workerIndex}${info.repeatEachIndex}`;
	seedKid(kidId, 'Kid Edit');
	try {
		await gotoHydrated(page, '/');
		await page.getByTestId('note-draw').click();
		const canvas = page.getByTestId('draw-canvas');
		await page.getByTestId('draw-shapes-open').click();
		await page.getByTestId('draw-shape').and(page.locator('[data-shape="square"]')).click();
		await pointerStroke(page, 'touch', 0.5, [0.2, 0.2], [0.5, 0.35], 1);
		await expect(canvas).toHaveAttribute('data-selected', 'true');
		await expect(page.getByTestId('draw-handle')).toHaveCount(2);
		for (const h of await page.getByTestId('draw-handle').all()) await expectTappable(h, 96);
		const placed = (await inkBox(page))!;
		expect(placed.w).toBeGreaterThan(placed.h);

		// Dragging inside moves it; it is still one undoable item.
		await pointerStroke(page, 'touch', 0.5, [0.35, 0.275], [0.6, 0.6], 2);
		const moved = (await inkBox(page))!;
		expect(moved.x0).toBeGreaterThan(placed.x0 + 20);
		expect(moved.y0).toBeGreaterThan(placed.y0 + 20);
		expect(Math.abs(moved.w - placed.w)).toBeLessThan(2);
		await expect(canvas).toHaveAttribute('data-strokes', '1');

		// The turn handle swings it a quarter turn: wide becomes tall.
		const cx = moved.x0 + moved.w / 2;
		const cy = moved.y0 + moved.h / 2;
		await dragHandle(page, 'rotate', [cx + 120, cy], 3);
		const turned = (await inkBox(page))!;
		expect(turned.h).toBeGreaterThan(turned.w);
		expect(Math.abs(Number(await canvas.getAttribute('data-sel-rot')))).toBeGreaterThan(1.2);

		// The resize handle grows it.
		const rb = (await page
			.locator('[data-testid="draw-handle"][data-handle="resize"]')
			.boundingBox())!;
		const cb = (await canvas.boundingBox())!;
		const hx = rb.x - cb.x + rb.width / 2;
		const hy = rb.y - cb.y + rb.height / 2;
		const away = Math.hypot(hx - cx, hy - cy) || 1;
		await dragHandle(
			page,
			'resize',
			[hx + ((hx - cx) / away) * 60, hy + ((hy - cy) / away) * 60],
			4
		);
		const grown = (await inkBox(page))!;
		expect(grown.w * grown.h).toBeGreaterThan(turned.w * turned.h);

		// Tapping elsewhere commits it without placing another shape.
		await pointerStroke(page, 'touch', 0.5, [0.95, 0.95], [0.95, 0.95], 5);
		await expect(canvas).toHaveAttribute('data-selected', 'false');
		await expect(page.getByTestId('draw-handle')).toHaveCount(0);

		await page.getByTestId('draw-shapes-open').click();
		await page.getByTestId('draw-shape').and(page.locator('[data-shape="cat"]')).click();
		await pointerStroke(page, 'touch', 0.5, [0.1, 0.6], [0.3, 0.9], 6);
		await expect(canvas).toHaveAttribute('data-selected', 'true');
		await page.getByTestId('draw-shapes-open').click();
		await page.getByTestId('draw-shape-off').click();
		await expect(canvas).toHaveAttribute('data-selected', 'false');
		await page.getByTestId('draw-undo').click();
		await page.getByTestId('draw-undo').click();
		await expect(canvas).toHaveAttribute('data-strokes', '0');
		expect(await inkPixels(page)).toBe(0);
		await page.getByTestId('draw-close').click();
	} finally {
		wipe(kidId);
	}
});

/** Count of opaque pixels that read mostly red, and of those that read mostly dark. */
const inkTones = (page: Page) =>
	page.getByTestId('draw-canvas').evaluate((c: HTMLCanvasElement) => {
		const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
		let red = 0;
		let dark = 0;
		for (let i = 0; i < d.length; i += 4) {
			if (d[i + 3] < 200) continue;
			if (d[i] > 150 && d[i + 1] < 110 && d[i + 2] < 110) red++;
			else if (d[i] < 90 && d[i + 1] < 90 && d[i + 2] < 90) dark++;
		}
		return { red, dark };
	});

test('picking a color, size or fill restyles the selected shape @J18.9', async ({ page }, info) => {
	const kidId = `e2e-draw-kid9-${info.workerIndex}${info.repeatEachIndex}`;
	seedKid(kidId, 'Kid Restyle');
	try {
		await gotoHydrated(page, '/');
		await page.getByTestId('note-draw').click();
		const canvas = page.getByTestId('draw-canvas');
		await page.getByTestId('draw-shapes-open').click();
		await page.getByTestId('draw-shape').and(page.locator('[data-shape="square"]')).click();
		await pointerStroke(page, 'touch', 0.5, [0.2, 0.2], [0.5, 0.45], 1);
		await expect(canvas).toHaveAttribute('data-selected', 'true');
		const before = await inkTones(page);
		expect(before.dark).toBeGreaterThan(100);
		expect(before.red).toBe(0);
		const thin = await inkPixels(page);

		// Color: the placed shape turns red, stays selected, and is still one item.
		const red = page.getByTestId('draw-color').and(page.locator('[data-color="draw-red"]'));
		await expectTappable(red, 96);
		await red.click();
		await expect(canvas).toHaveAttribute('data-selected', 'true');
		await expect(canvas).toHaveAttribute('data-strokes', '1');
		const after = await inkTones(page);
		expect(after.red).toBeGreaterThan(100);
		expect(after.dark).toBe(0);

		// Size: a thicker brush widens the outline.
		await page.getByTestId('draw-size').and(page.locator('[data-size="marker"]')).click();
		expect(await inkPixels(page)).toBeGreaterThan(thin);

		// Fill: the body fills in.
		const outlined = await inkPixels(page);
		await page.getByTestId('draw-shapes-open').click();
		await page.getByTestId('draw-fill').and(page.locator('[data-filled="true"]')).click();
		expect(await inkPixels(page)).toBeGreaterThan(outlined * 2);
		await expect(canvas).toHaveAttribute('data-selected', 'true');

		// One undo takes the whole shape away.
		await page.getByTestId('draw-shape-off').click();
		await page.getByTestId('draw-undo').click();
		await expect(canvas).toHaveAttribute('data-strokes', '0');
		expect(await inkPixels(page)).toBe(0);
		await page.getByTestId('draw-close').click();
	} finally {
		wipe(kidId);
	}
});

/** RGBA of the first pixel of an image data URL. */
const thumbPixel = (page: Page, src: string, fx: number, fy: number) =>
	page.evaluate(
		async ({ src, fx, fy }) => {
			const img = new Image();
			img.src = src;
			await img.decode();
			const c = document.createElement('canvas');
			c.width = img.width;
			c.height = img.height;
			const o = c.getContext('2d')!;
			o.drawImage(img, 0, 0);
			return Array.from(
				o.getImageData(Math.floor(img.width * fx), Math.floor(img.height * fy), 1, 1).data
			);
		},
		{ src, fx, fy }
	);

test('background color: erasing reveals it, and it saves and reopens @J18.10', async ({
	page
}, info) => {
	const kidId = `e2e-draw-kid10-${info.workerIndex}${info.repeatEachIndex}`;
	const name = `Kid Painter ${info.workerIndex}${info.repeatEachIndex}`;
	seedKid(kidId, name);
	try {
		await gotoHydrated(page, '/');
		await page.getByTestId('note-draw').click();
		const canvas = page.getByTestId('draw-canvas');
		const holder = page.getByTestId('draw-holder');
		await expectTappable(page.getByTestId('draw-bg-open'), 96);
		await page.getByTestId('draw-bg-open').click();
		await expect(page.getByTestId('draw-bg-color')).toHaveCount(48);
		await expectTappable(page.getByTestId('draw-bg-color').first(), 96);
		await expectTappable(page.getByTestId('draw-bg-paper'), 96);
		await page.getByTestId('draw-bg-color').nth(5).click();
		await expect(holder).not.toHaveAttribute('data-bg', '');
		// A background alone is not a drawing; the ink layer stays empty.
		await expect(canvas).toHaveAttribute('data-blank', 'true');
		expect(await inkPixels(page)).toBe(0);

		// Draw a stroke, then rub it out: nothing is left on the ink layer, so the color shows.
		await pointerStroke(page, 'pen', 0.9, [0.1, 0.5], [0.9, 0.5], 1);
		expect(await inkPixels(page)).toBeGreaterThan(0);
		await page.getByTestId('draw-eraser').click();
		await pointerStroke(page, 'pen', 1, [0.05, 0.5], [0.95, 0.5], 2);
		await pointerStroke(page, 'pen', 1, [0.05, 0.48], [0.95, 0.48], 3);
		await pointerStroke(page, 'pen', 1, [0.05, 0.52], [0.95, 0.52], 4);
		expect(await inkPixels(page)).toBe(0);
		await page.getByTestId('draw-eraser').click();
		await pointerStroke(page, 'pen', 0.9, [0.1, 0.2], [0.9, 0.3], 5);

		// Save: the thumbnail is painted on the chosen color, not on paper.
		await page.getByTestId('draw-save').click();
		await page.getByTestId('draw-author').filter({ hasText: name }).click();
		await expect(page.getByTestId('draw-note')).toHaveText('Saved!');
		const rows: { thumb: string }[] = await page.evaluate(() =>
			fetch('/api/drawings').then((r) => r.json())
		);
		expect(rows.length).toBeGreaterThan(0);
		const [r, g, b, a] = await thumbPixel(page, rows[0].thumb, 0.5, 0.9);
		expect(a).toBe(255);
		expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeGreaterThan(20);

		// Back to paper, then reopen: the color comes back.
		await page.getByTestId('draw-bg-open').click();
		await page.getByTestId('draw-bg-paper').click();
		await expect(holder).toHaveAttribute('data-bg', '');
		await page.getByTestId('draw-browse').click();
		await page.getByRole('button', { name: `Open drawing by ${name}` }).click();
		await expect(holder).not.toHaveAttribute('data-bg', '');
		await page.getByTestId('draw-close').click();
	} finally {
		wipe(kidId);
	}
});

/** RGBA at a fraction of a layer canvas. */
const layerPixel = (page: Page, testId: string, fx: number, fy: number) =>
	page
		.getByTestId(testId)
		.evaluate(
			(c: HTMLCanvasElement, f) =>
				Array.from(
					c
						.getContext('2d')!
						.getImageData(Math.floor(c.width * f.fx), Math.floor(c.height * f.fy), 1, 1).data
				),
			{ fx, fy }
		);

test('draw on a photo from the library: it stays when erased, and saves with the drawing @J18.11', async ({
	page
}, info) => {
	const kidId = `e2e-draw-kid11-${info.workerIndex}${info.repeatEachIndex}`;
	const name = `Kid Photographer ${info.workerIndex}${info.repeatEachIndex}`;
	seedKid(kidId, name);
	const run = `${Date.now().toString(36)}-${info.parallelIndex}-${info.repeatEachIndex}`;
	const root = resolve(DATA_DIR, 'photo-library', `e2e-draw-${info.project.name}-${run}`);
	rmSync(root, { recursive: true, force: true });
	mkdirSync(root, { recursive: true });
	// Synthetic picture (left red, right blue), never a real photo.
	writeFileSync(`${root}/a.jpg`, await syntheticJpeg(640, 360));
	await signInAsAdult(page, `e2e-draw-photo-${info.project.name}`);
	const made = await page.request.post('/api/photo-sources', {
		data: { kind: 'folder', label: `Draw ${run}`, root }
	});
	expect(made.status()).toBe(201);
	const sourceId: string = (await made.json()).id;
	try {
		const images: { id: string }[] = await (
			await page.request.get(`/api/photo-sources/${sourceId}/images`)
		).json();
		const photoId = images[0].id;

		await gotoHydrated(page, '/');
		await page.getByTestId('note-draw').click();
		const canvas = page.getByTestId('draw-canvas');
		await expectTappable(page.getByTestId('draw-photo-open'), 96);
		await page.getByTestId('draw-photo-open').click();
		const mine = page.getByTestId('draw-photo').and(page.locator(`[data-photo-id="${photoId}"]`));
		await expectTappable(mine, 96);
		await mine.click();
		await expect(canvas).toHaveAttribute('data-photo', photoId);
		// A photo alone is not a drawing yet; the ink layer is empty.
		await expect(canvas).toHaveAttribute('data-blank', 'true');
		expect(await inkPixels(page)).toBe(0);

		// The picture is painted whole and centred: red on the left, blue on the right.
		await expect
			.poll(() => layerPixel(page, 'draw-photo-layer', 0.5, 0.5).then((p) => p[3]))
			.toBe(255);
		const left = await layerPixel(page, 'draw-photo-layer', 0.45, 0.5);
		const right = await layerPixel(page, 'draw-photo-layer', 0.55, 0.5);
		expect(left[0]).toBeGreaterThan(left[2]);
		expect(right[2]).toBeGreaterThan(right[0]);

		// Draw, then erase everywhere: the photo is still there.
		await pointerStroke(page, 'pen', 0.9, [0.1, 0.5], [0.9, 0.5], 1);
		expect(await inkPixels(page)).toBeGreaterThan(0);
		await page.getByTestId('draw-eraser').click();
		for (const [i, y] of [0.48, 0.5, 0.52].entries())
			await pointerStroke(page, 'pen', 1, [0.05, y], [0.95, y], 2 + i);
		expect(await inkPixels(page)).toBe(0);
		await page.getByTestId('draw-eraser').click();
		expect((await layerPixel(page, 'draw-photo-layer', 0.55, 0.5))[3]).toBe(255);
		await pointerStroke(page, 'pen', 0.9, [0.1, 0.2], [0.9, 0.3], 5);

		// Save, drop the photo, reopen: the photo comes back; the thumbnail has the picture in it.
		await page.getByTestId('draw-save').click();
		await page.getByTestId('draw-author').filter({ hasText: name }).click();
		await expect(page.getByTestId('draw-note')).toHaveText('Saved!');
		const rows: { thumb: string; memberName: string }[] = await page.evaluate(() =>
			fetch('/api/drawings').then((r) => r.json())
		);
		const row = rows.find((r) => r.memberName === name)!;
		const [r, , b] = await thumbPixel(page, row.thumb, 0.45, 0.55);
		expect(r).toBeGreaterThan(b);
		const [r2, , b2] = await thumbPixel(page, row.thumb, 0.55, 0.55);
		expect(b2).toBeGreaterThan(r2);
		await page.getByTestId('draw-photo-open').click();
		await page.getByTestId('draw-photo-none').click();
		await expect(canvas).toHaveAttribute('data-photo', '');
		await page.getByTestId('draw-browse').click();
		await page.getByRole('button', { name: `Open drawing by ${name}` }).click();
		await expect(canvas).toHaveAttribute('data-photo', photoId);
		await expect
			.poll(() => layerPixel(page, 'draw-photo-layer', 0.55, 0.5).then((p) => p[3]))
			.toBe(255);
		await page.getByTestId('draw-close').click();
	} finally {
		wipe(kidId);
		await page.request.delete(`/api/photo-sources/${sourceId}`, { data: {} });
		rmSync(root, { recursive: true, force: true });
	}
});

const opacityOf = (page: Page, testId: string) =>
	page.getByTestId(testId).evaluate((c) => getComputedStyle(c).opacity);

test('layers: hide the drawing or the picture, drawing again brings it back @J18.12', async ({
	page
}, info) => {
	const kidId = `e2e-draw-kid12-${info.workerIndex}${info.repeatEachIndex}`;
	const name = `Kid Layerer ${info.workerIndex}${info.repeatEachIndex}`;
	seedKid(kidId, name);
	try {
		await gotoHydrated(page, '/');
		await page.getByTestId('note-draw').click();
		const canvas = page.getByTestId('draw-canvas');
		await expectTappable(page.getByTestId('draw-layers-open'), 96);

		// A plain board has one layer to switch: the drawing.
		await page.getByTestId('draw-layers-open').click();
		await expect(page.getByTestId('draw-layer')).toHaveCount(1);
		await expectTappable(page.getByTestId('draw-layer'), 96);
		await page.getByTestId('draw-layers-close').click();

		// A colored background and a stroke; hide the drawing and post: the stroke is not in the image.
		await page.getByTestId('draw-bg-open').click();
		await page.getByTestId('draw-bg-color').nth(5).click();
		await pointerStroke(page, 'pen', 0.9, [0.1, 0.5], [0.9, 0.5], 1);
		expect(await inkPixels(page)).toBeGreaterThan(0);
		await page.getByTestId('draw-layers-open').click();
		await page.getByTestId('draw-layer').click();
		await expect(canvas).toHaveAttribute('data-layer-drawing', 'false');
		expect(await opacityOf(page, 'draw-canvas')).toBe('0');
		await page.getByTestId('draw-layers-close').click();
		await page.getByTestId('draw-post').click();
		await page.getByTestId('draw-author').filter({ hasText: name }).click();
		await expect(page.getByTestId('draw-sheet')).toHaveCount(0);
		const notes = (await (await page.request.get('/api/notes')).json()) as {
			authorId: string;
			imageUrl: string | null;
		}[];
		const png = await page.request.get(notes.find((n) => n.authorId === kidId)!.imageUrl!);
		const dataUrl = `data:image/png;base64,${(await png.body()).toString('base64')}`;
		const [r, g, b] = await thumbPixel(page, dataUrl, 0.5, 0.5);
		// Background (a chosen grid color) at the stroke's spot, not near-black ink.
		expect(Math.max(r, g, b)).toBeGreaterThan(120);
		await page.getByTestId('note').filter({ hasText: name }).getByTestId('note-dismiss').click();

		// Drawing on a hidden layer shows it again first.
		await page.getByTestId('note-draw').click();
		await page.getByTestId('draw-layers-open').click();
		await page.getByTestId('draw-layer').click();
		await page.getByTestId('draw-layers-close').click();
		await pointerStroke(page, 'pen', 0.9, [0.1, 0.5], [0.9, 0.5], 2);
		await expect(canvas).toHaveAttribute('data-layer-drawing', 'true');
		expect(await opacityOf(page, 'draw-canvas')).toBe('1');

		// With a coloring page there is a second layer: the picture.
		await page.getByTestId('draw-pages-open').click();
		await page.getByTestId('draw-page').and(page.locator('[data-page="fish"]')).click();
		await expect(canvas).toHaveAttribute('data-page', 'fish');
		expect(await lineInk(page)).toBeGreaterThan(2000);
		await page.getByTestId('draw-layers-open').click();
		await expect(page.getByTestId('draw-layer')).toHaveCount(2);
		await page.getByTestId('draw-layer').and(page.locator('[data-layer="picture"]')).click();
		await expect(canvas).toHaveAttribute('data-layer-picture', 'false');
		expect(await opacityOf(page, 'draw-lines')).toBe('0');
		await page.getByTestId('draw-layer').and(page.locator('[data-layer="picture"]')).click();
		expect(await opacityOf(page, 'draw-lines')).toBe('1');
		await page.getByTestId('draw-layers-close').click();
		await page.getByTestId('draw-close').click();
	} finally {
		wipe(kidId);
	}
});

test('no background picked: the saved thumbnail and the posted PNG are paper, not black @J18.13', async ({
	page
}, info) => {
	const kidId = `e2e-draw-kid13-${info.workerIndex}${info.repeatEachIndex}`;
	const name = `Kid Paper ${info.workerIndex}${info.repeatEachIndex}`;
	seedKid(kidId, name);
	try {
		await gotoHydrated(page, '/');
		await page.getByTestId('note-draw').click();
		await expect(page.getByTestId('draw-holder')).toHaveAttribute('data-bg', '');
		await pointerStroke(page, 'pen', 0.9, [0.4, 0.5], [0.6, 0.5], 1);

		const light = (px: number[]) => {
			expect(px[3]).toBe(255);
			expect(Math.min(px[0], px[1], px[2])).toBeGreaterThan(230);
		};

		await page.getByTestId('draw-save').click();
		await page.getByTestId('draw-author').filter({ hasText: name }).click();
		await expect(page.getByTestId('draw-note')).toHaveText('Saved!');
		const rows: { thumb: string }[] = await page.evaluate(() =>
			fetch('/api/drawings').then((r) => r.json())
		);
		light(await thumbPixel(page, rows[0].thumb, 0.02, 0.02));

		await page.getByTestId('draw-post').click();
		await page.getByTestId('draw-author').filter({ hasText: name }).click();
		await expect(page.getByTestId('draw-sheet')).toHaveCount(0);
		await expect
			.poll(async () => {
				const notes = (await (await page.request.get('/api/notes')).json()) as {
					authorId: string;
					imageUrl: string | null;
				}[];
				return notes.some((n) => n.authorId === kidId && n.imageUrl);
			})
			.toBe(true);
		const notes = (await (await page.request.get('/api/notes')).json()) as {
			authorId: string;
			imageUrl: string | null;
		}[];
		const mine = notes.find((n) => n.authorId === kidId)!;
		light(await thumbPixel(page, mine.imageUrl!, 0.02, 0.02));
	} finally {
		wipe(kidId);
	}
});
