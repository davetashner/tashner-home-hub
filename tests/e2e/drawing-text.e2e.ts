import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { ensureHousehold } from './adult';
import { gotoHydrated } from './hydrated';
import { expectTappable } from './tap';
import { trackMember } from './cleanup';
import { DB_PATH } from './data-dir';

// hub-cn7.23: the text tool. Runs in both wall orientations.

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

/** Opaque pixels on the canvas, their bounding box (CSS px) and the first one's color. */
const ink = (page: Page) =>
	page.getByTestId('draw-canvas').evaluate((c: HTMLCanvasElement) => {
		const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
		const k = c.width / c.getBoundingClientRect().width;
		let n = 0;
		let [x0, y0, x1, y1] = [Infinity, Infinity, -1, -1];
		let rgb: number[] | null = null;
		for (let i = 0; i < d.length; i += 4) {
			if (d[i + 3] === 0) continue;
			n++;
			const x = (i / 4) % c.width;
			const y = Math.floor(i / 4 / c.width);
			[x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
			if (!rgb && d[i + 3] > 200) rgb = [d[i], d[i + 1], d[i + 2]];
		}
		return { n, rgb, x: x0 / k, y: y0 / k, w: (x1 - x0) / k, h: (y1 - y0) / k };
	});

/** Touch events on an element: a tap, or a drag from the element's centre (or a point) to `to`. */
const touch = (target: Locator, from: [number, number] | null, to: [number, number], id: number) =>
	target.evaluate(
		(el, a) => {
			const r = el.getBoundingClientRect();
			const [sx, sy] = a.from ?? [r.left + r.width / 2, r.top + r.height / 2];
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
			fire('pointerdown', sx, sy);
			for (let i = 1; i <= 8; i++)
				fire('pointermove', sx + ((a.to[0] - sx) * i) / 8, sy + ((a.to[1] - sy) * i) / 8);
			fire('pointerup', a.to[0], a.to[1]);
		},
		{ from, to, id }
	);

/** Tap the board at a fraction of its size, or at a CSS px point relative to it. */
async function tapBoard(page: Page, at: [number, number], px = false) {
	const b = (await page.getByTestId('draw-canvas').boundingBox())!;
	const p: [number, number] = px
		? [b.x + at[0], b.y + at[1]]
		: [b.x + at[0] * b.width, b.y + at[1] * b.height];
	await touch(page.getByTestId('draw-canvas'), p, p, 1);
}

async function dragHandle(page: Page, which: 'resize' | 'rotate', to: [number, number]) {
	const b = (await page.getByTestId('draw-canvas').boundingBox())!;
	const handle = page.locator(`[data-testid="draw-handle"][data-handle="${which}"]`);
	await touch(handle, null, [b.x + to[0], b.y + to[1]], 2);
}

const middle = (b: { x: number; y: number; w: number; h: number }): [number, number] => [
	b.x + b.w / 2,
	b.y + b.h / 2
];

test('type big text, then resize, turn, recolor, edit and discard it', async ({ page }, info) => {
	const kidId = `e2e-draw-text-${info.workerIndex}${info.repeatEachIndex}`;
	seedKid(kidId, 'Kid Text');
	await gotoHydrated(page, '/');
	await page.getByTestId('note-draw').click();
	const canvas = page.getByTestId('draw-canvas');
	await page.getByTestId('draw-text').click();
	for (const s of await page.getByTestId('draw-text-size').all()) await expectTappable(s, 96);

	await page.getByTestId('draw-text-size').and(page.locator('[data-size="medium"]')).click();
	await tapBoard(page, [0.15, 0.3]);
	const field = page.getByTestId('draw-text-input');
	await expect(field).toBeFocused();
	expect(await field.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBe(80);
	await field.fill('Hi');
	await page.getByTestId('draw-text-done').click();
	await expect(canvas).toHaveAttribute('data-strokes', '1');
	const placed = await ink(page);

	expect(Math.max(...placed.rgb!)).toBeLessThan(120);
	await page.getByTestId('draw-color').nth(1).click();
	await expect.poll(async () => (await ink(page)).rgb![0]).toBeGreaterThan(150);

	await page.getByTestId('draw-text-size').and(page.locator('[data-size="huge"]')).click();
	const huge = await ink(page);
	expect(huge.h).toBeGreaterThan(placed.h * 1.8);
	await dragHandle(page, 'resize', [huge.x + huge.w * 1.5, huge.y + huge.h * 1.5]);
	const grown = await ink(page);
	expect(grown.h).toBeGreaterThan(huge.h);
	await dragHandle(page, 'rotate', [middle(grown)[0] + 300, middle(grown)[1]]);
	await expect(canvas).not.toHaveAttribute('data-sel-rot', '0.000');

	// Tapping it again edits the words; emptying them discards the text.
	await tapBoard(page, middle(await ink(page)), true);
	await expect(field).toHaveValue('Hi');
	await field.fill('Hello there');
	await page.getByTestId('draw-text-done').click();
	await tapBoard(page, middle(await ink(page)), true);
	await expect(field).toHaveValue('Hello there');
	await field.fill('');
	await page.getByTestId('draw-text-done').click();
	await expect(canvas).toHaveAttribute('data-strokes', '0');
	expect((await ink(page)).n).toBe(0);
});
