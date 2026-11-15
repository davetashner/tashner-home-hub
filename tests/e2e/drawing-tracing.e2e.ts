import { reveal } from './drawing-sections';
import { expect, test, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { ensureHousehold } from './adult';
import { gotoHydrated } from './hydrated';
import { expectTappable } from './tap';
import { trackMember } from './cleanup';
import { DB_PATH } from './data-dir';

// hub-t27j.13: letter and number tracing pages: dotted guides that cannot be erased.

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

const opaque = (page: Page, testid: string) =>
	page.getByTestId(testid).evaluate((c: HTMLCanvasElement) => {
		const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
		let n = 0;
		for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
		return n;
	});

/** Guide pixels, once the line layer has refit to the board's laid-out size. */
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
	return opaque(page, 'draw-lines');
};

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

test('tracing page: dotted guide stays, trace over it, undo, save and reopen @J18.23', async ({
	page
}, info) => {
	const kidId = `e2e-trace-kid-${info.workerIndex}${info.repeatEachIndex}`;
	const name = `Kid Tracer ${info.workerIndex}${info.repeatEachIndex}`;
	seedKid(kidId, name);
	try {
		await gotoHydrated(page, '/');
		await page.getByTestId('note-draw').click();
		const canvas = page.getByTestId('draw-canvas');
		await reveal(page, 'draw-pages-open');
		await page.getByTestId('draw-pages-open').click();
		await expect(page.getByTestId('draw-trace')).toHaveCount(36);
		await expectTappable(page.getByTestId('draw-trace').first(), 96);
		await expectTappable(page.getByTestId('draw-trace').last(), 96);
		// All 36 buttons fit inside the picker on the 4K touch monitor too.
		const wall = page.viewportSize();
		for (const size of [wall, { width: 3840, height: 2160 }]) {
			if (size) await page.setViewportSize(size);
			const box = await page.getByTestId('draw-tracing').boundingBox();
			const vp = page.viewportSize()!;
			expect(box!.x).toBeGreaterThanOrEqual(0);
			expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width);
		}
		if (wall) await page.setViewportSize(wall);

		await page.getByTestId('draw-trace').and(page.locator('[data-page="trace-A"]')).click();
		await expect(canvas).toHaveAttribute('data-page', 'trace-A');
		const guide = await lineInk(page);
		expect(guide).toBeGreaterThan(1000);
		await expect(canvas).toHaveAttribute('data-blank', 'true');
		expect(await opaque(page, 'draw-canvas')).toBe(0);

		// The eraser cannot rub the dots out.
		await page.getByTestId('draw-eraser').click();
		await stroke(page, [0.1, 0.5], [0.9, 0.5], 1);
		expect(await lineInk(page)).toBe(guide);
		// Back to the pen.
		await page.getByTestId('draw-pen').click();
		await expect(page.getByTestId('draw-eraser')).toHaveAttribute('aria-pressed', 'false');

		// Trace over the guide; undo takes the ink away but not the guide.
		await stroke(page, [0.5, 0.2], [0.4, 0.85], 2);
		// (The erase pass above is stroke 1 and left nothing behind.)
		await expect(canvas).toHaveAttribute('data-strokes', '2');
		const ink = await opaque(page, 'draw-canvas');
		expect(ink).toBeGreaterThan(500);
		await page.getByTestId('draw-undo').click();
		await expect(canvas).toHaveAttribute('data-strokes', '1');
		expect(await opaque(page, 'draw-canvas')).toBe(0);
		expect(await lineInk(page)).toBe(guide);
		await page.getByTestId('draw-redo').click();
		expect(await opaque(page, 'draw-canvas')).toBe(ink);

		// Save, switch to a blank page, reopen: the guide and the tracing come back.
		await page.getByTestId('draw-save').click();
		await page.getByTestId('draw-author').filter({ hasText: name }).click();
		await expect(page.getByTestId('draw-note')).toHaveText('Saved!');
		await reveal(page, 'draw-pages-open');
		await page.getByTestId('draw-pages-open').click();
		await page.getByTestId('draw-page-none').click();
		await expect(canvas).toHaveAttribute('data-page', '');
		expect(await lineInk(page)).toBe(0);
		await page.getByTestId('draw-browse').click();
		await page.getByRole('button', { name: `Open drawing by ${name}` }).click();
		await expect(canvas).toHaveAttribute('data-page', 'trace-A');
		expect(await lineInk(page)).toBe(guide);
		await expect.poll(() => opaque(page, 'draw-canvas')).toBeGreaterThan(ink * 0.8);

		// A number works the same way.
		await reveal(page, 'draw-pages-open');
		await page.getByTestId('draw-pages-open').click();
		await page.getByTestId('draw-trace').and(page.locator('[data-page="trace-7"]')).click();
		await expect(canvas).toHaveAttribute('data-page', 'trace-7');
		expect(await lineInk(page)).toBeGreaterThan(500);
		await page.getByTestId('draw-close').click();
	} finally {
		wipe(kidId);
	}
});
