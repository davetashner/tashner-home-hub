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
