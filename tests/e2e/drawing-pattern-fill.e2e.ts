import { reveal } from './drawing-sections';
import { expect, test, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { ensureHousehold } from './adult';
import { gotoHydrated } from './hydrated';
import { expectTappable } from './tap';
import { trackMember } from './cleanup';
import { DB_PATH } from './data-dir';

// hub-t27j.2: the paint bucket can fill with stripes, dots, stars, scales or bricks.

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

test('bucket fills a closed shape with a pattern, undo, save and reopen, post @J18.22', async ({
	page
}, info) => {
	const kidId = `e2e-pattern-kid-${info.workerIndex}${info.repeatEachIndex}`;
	const name = `Kid Pattern ${info.workerIndex}${info.repeatEachIndex}`;
	seedKid(kidId, name);
	try {
		await gotoHydrated(page, '/');
		await page.getByTestId('note-draw').click();
		const canvas = page.getByTestId('draw-canvas');

		// Outline a square, then switch to the bucket: the style picker appears.
		await page.getByTestId('draw-shapes-open').click();
		await page.getByTestId('draw-shape').and(page.locator('[data-shape="square"]')).click();
		await stroke(page, [0.2, 0.2], [0.6, 0.6], 1);
		const outline = await ink(page);
		await page.getByTestId('draw-bucket').click();
		await expect(page.getByTestId('draw-fill-styles')).toBeVisible();
		await expect(page.getByTestId('draw-fill-style')).toHaveCount(6);
		await expectTappable(page.getByTestId('draw-fill-style').first(), 96);
		await expect(style(page, 'solid')).toHaveAttribute('aria-pressed', 'true');
		await page.getByTestId('draw-color').and(page.locator('[data-color="draw-red"]')).click();

		// A 4K monitor at scale 1: every style chip stays inside the panel.
		const wall = page.viewportSize();
		for (const size of [wall, { width: 3840, height: 2160 }]) {
			if (size) await page.setViewportSize(size);
			const panel = await page.getByTestId('draw-fill-styles').boundingBox();
			const vw = size?.width ?? 0;
			expect(panel!.x + panel!.width).toBeLessThanOrEqual(vw);
			for (const chip of await page.getByTestId('draw-fill-style').all()) {
				const b = (await chip.boundingBox())!;
				expect(b.x + b.width).toBeLessThanOrEqual(vw);
				expect(b.width).toBeGreaterThanOrEqual(96);
			}
		}
		if (wall) await page.setViewportSize(wall);

		// Solid first, for the area to compare against; undo it.
		await stroke(page, [0.4, 0.4], [0.4, 0.4], 2);
		const solid = await ink(page);
		await page.getByTestId('draw-undo').click();
		expect(await ink(page)).toBe(outline);

		// Each pattern paints part of the inside only: less ink than solid, more than the outline.
		const counts: number[] = [];
		for (const s of ['stripes', 'dots', 'stars', 'scales', 'bricks']) {
			await style(page, s).click();
			await expect(style(page, s)).toHaveAttribute('aria-pressed', 'true');
			await stroke(page, [0.4, 0.4], [0.4, 0.4], 3);
			const n = await ink(page);
			expect(n, s).toBeGreaterThan(outline);
			expect(n, s).toBeLessThan(solid);
			expect(await inkOutside(page, [0.19, 0.19, 0.61, 0.61]), s).toBe(0);
			counts.push(n);
			await page.getByTestId('draw-undo').click();
			expect(await ink(page)).toBe(outline);
		}
		expect(new Set(counts).size).toBeGreaterThan(2);

		// Redo brings it back; the stars fill is what we save.
		await page.getByTestId('draw-undo').isVisible();
		await style(page, 'stars').click();
		await stroke(page, [0.4, 0.4], [0.4, 0.4], 4);
		const stars = await ink(page);
		await page.getByTestId('draw-undo').click();
		await page.getByTestId('draw-redo').click();
		expect(await ink(page)).toBe(stars);

		await page.getByTestId('draw-save').click();
		await page.getByTestId('draw-author').filter({ hasText: name }).click();
		await expect(page.getByTestId('draw-note')).toHaveText('Saved!');

		// Clear, reopen: the pattern (not a solid fill) is back.
		await reveal(page, 'draw-clear');
		await page.getByTestId('draw-clear').click();
		expect(await ink(page)).toBe(0);
		await page.getByTestId('draw-browse').click();
		await page.getByRole('button', { name: `Open drawing by ${name}` }).click();
		await expect(canvas).toHaveAttribute('data-strokes', '2');
		await expect.poll(() => ink(page)).toBeGreaterThan(outline);
		const back = await ink(page);
		expect(back).toBeLessThan(solid);
		expect(Math.abs(back - stars)).toBeLessThan(stars * 0.05);

		// Post it: the note carries the picture.
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
