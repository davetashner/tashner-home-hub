import { reveal } from './drawing-sections';
import { expect, test, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { ensureHousehold } from './adult';
import { gotoHydrated } from './hydrated';
import { expectTappable } from './tap';
import { trackMember } from './cleanup';
import { DB_PATH } from './data-dir';

// hub-t27j.3: the paint bucket can fill with a vertical two-color gradient.

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

/** Ink pixels on the canvas, and the bounding box of those inside x/y fractions [lo, hi]. */
const ink = (page: Page) =>
	page.getByTestId('draw-canvas').evaluate((c: HTMLCanvasElement) => {
		const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
		let n = 0;
		for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
		return n;
	});

/** Ink pixels outside the box spanning the given fractions of the canvas. */
const inkOutside = (page: Page, box: [number, number, number, number]) =>
	page.getByTestId('draw-canvas').evaluate((c: HTMLCanvasElement, b) => {
		const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
		let n = 0;
		for (let y = 0; y < c.height; y++)
			for (let x = 0; x < c.width; x++) {
				const fx = x / c.width;
				const fy = y / c.height;
				if (fx < b[0] || fx > b[2] || fy < b[1] || fy > b[3]) if (d[(y * c.width + x) * 4 + 3]) n++;
			}
		return n;
	}, box);

async function stroke(page: Page, from: [number, number], to: [number, number], id: number) {
	await page.getByTestId('draw-canvas').evaluate(
		(c, a) => {
			const r = c.getBoundingClientRect();
			const fire = (name: string, x: number, y: number) =>
				c.dispatchEvent(
					new PointerEvent(name, {
						pointerId: a.id,
						pointerType: 'touch',
						pressure: 0.5,
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
		{ from, to, id }
	);
}

const style = (page: Page, s: string) =>
	page.getByTestId('draw-fill-style').and(page.locator(`[data-style="${s}"]`));

/** Green channel (0-255) of the canvas pixel at fractions (fx, fy), or -1 where it is clear. */
const greenAt = (page: Page, fx: number, fy: number) =>
	page.getByTestId('draw-canvas').evaluate(
		(c: HTMLCanvasElement, a) => {
			const d = c
				.getContext('2d')!
				.getImageData(Math.floor(a[0] * c.width), Math.floor(a[1] * c.height), 1, 1).data;
			return d[3] ? d[1] : -1;
		},
		[fx, fy]
	);

test('bucket fills a closed shape with a two-color gradient, undo, save and reopen, post @J18.29', async ({
	page
}, info) => {
	const kidId = `e2e-gradient-kid-${info.workerIndex}${info.repeatEachIndex}`;
	const name = `Kid Gradient ${info.workerIndex}${info.repeatEachIndex}`;
	seedKid(kidId, name);
	try {
		await gotoHydrated(page, '/');
		await page.getByTestId('note-draw').click();
		const canvas = page.getByTestId('draw-canvas');

		await page.getByTestId('draw-shapes-open').click();
		await page.getByTestId('draw-shape').and(page.locator('[data-shape="square"]')).click();
		await stroke(page, [0.2, 0.2], [0.6, 0.6], 1);
		const outline = await ink(page);
		await page.getByTestId('draw-bucket').click();
		await page.getByTestId('draw-color').and(page.locator('[data-color="draw-red"]')).click();

		// The second-color row only shows with Gradient selected, with big tappable swatches.
		await expect(page.getByTestId('draw-grad-ends')).toHaveCount(0);
		await style(page, 'gradient').click();
		await expect(style(page, 'gradient')).toHaveAttribute('aria-pressed', 'true');
		await expect(page.getByTestId('draw-grad-ends')).toBeVisible();
		await expectTappable(style(page, 'gradient'), 96);
		await expectTappable(page.getByTestId('draw-grad-end').first(), 96);
		await expect(
			page.getByTestId('draw-grad-end').and(page.locator('[aria-pressed="true"]'))
		).toHaveCount(1);

		// A 4K monitor at scale 1: the style chips and swatches stay inside the panel.
		const wall = page.viewportSize();
		for (const size of [wall, { width: 3840, height: 2160 }]) {
			if (size) await page.setViewportSize(size);
			const vw = size?.width ?? 0;
			for (const t of ['draw-fill-style', 'draw-grad-end']) {
				for (const chip of await page.getByTestId(t).all()) {
					const b = (await chip.boundingBox())!;
					expect(b.x + b.width, t).toBeLessThanOrEqual(vw);
					expect(b.width, t).toBeGreaterThanOrEqual(96);
				}
			}
		}
		if (wall) await page.setViewportSize(wall);

		// Default second color is white: the fill fades from red (green channel low) at the top
		// to white (high) at the bottom, and stays inside the square.
		await stroke(page, [0.4, 0.4], [0.4, 0.4], 2);
		const filled = await ink(page);
		expect(filled).toBeGreaterThan(outline);
		expect(await inkOutside(page, [0.19, 0.19, 0.61, 0.61])).toBe(0);
		const top = await greenAt(page, 0.4, 0.22);
		const bottom = await greenAt(page, 0.4, 0.58);
		expect(top).toBeGreaterThanOrEqual(0);
		expect(bottom - top).toBeGreaterThan(100);

		// Undo removes it; a second pick (the last swatch) changes the bottom color, not the top.
		await page.getByTestId('draw-undo').click();
		expect(await ink(page)).toBe(outline);
		await page.getByTestId('draw-grad-end').last().click();
		await stroke(page, [0.4, 0.4], [0.4, 0.4], 3);
		const dark = await greenAt(page, 0.4, 0.58);
		expect(bottom - dark).toBeGreaterThan(100);
		await page.getByTestId('draw-undo').click();
		await page.getByTestId('draw-redo').click();
		expect(await greenAt(page, 0.4, 0.58)).toBe(dark);

		await page.getByTestId('draw-save').click();
		await page.getByTestId('draw-author').filter({ hasText: name }).click();
		await expect(page.getByTestId('draw-note')).toHaveText('Saved!');

		await reveal(page, 'draw-clear');
		await page.getByTestId('draw-clear').click();
		expect(await ink(page)).toBe(0);
		await page.getByTestId('draw-browse').click();
		await page.getByRole('button', { name: `Open drawing by ${name}` }).click();
		await expect(canvas).toHaveAttribute('data-strokes', '2');
		await expect.poll(() => greenAt(page, 0.4, 0.58)).toBeLessThan(bottom - 100);
		expect(await greenAt(page, 0.4, 0.22)).toBeLessThan(dark + 60);
		expect(await inkOutside(page, [0.19, 0.19, 0.61, 0.61])).toBe(0);

		await page.getByTestId('draw-post').click();
		await page.getByTestId('draw-author').filter({ hasText: name }).click();
		await expect(page.getByTestId('draw-sheet')).toHaveCount(0);
		const notes = (await (await page.request.get('/api/notes')).json()) as {
			authorId: string;
			imageUrl: string | null;
		}[];
		expect(notes.find((n) => n.authorId === kidId)?.imageUrl).toBeTruthy();
	} finally {
		wipe(kidId);
	}
});
