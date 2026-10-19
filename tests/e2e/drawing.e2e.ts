import { expect, test, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { ensureHousehold } from './adult';
import { gotoHydrated } from './hydrated';
import { expectTappable } from './tap';
import { trackMember } from './cleanup';
import { DB_PATH } from './data-dir';

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
		await expect(page.getByTestId('draw-shape')).toHaveCount(15);
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

/** Opaque pixels on the coloring page's line layer. */
const lineInk = (page: Page) =>
	page.getByTestId('draw-lines').evaluate((c: HTMLCanvasElement) => {
		const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
		let n = 0;
		for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
		return n;
	});

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
