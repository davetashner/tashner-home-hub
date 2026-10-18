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
		await expect(page.getByTestId('draw-shape')).toHaveCount(10);
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
