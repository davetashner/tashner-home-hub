import { expect, test, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { ensureHousehold } from './adult';
import { gotoHydrated } from './hydrated';
import { expectTappable } from './tap';
import { trackMember } from './cleanup';
import { DB_PATH } from './data-dir';

// hub-cn7.16: house, tree, rocket, car and butterfly stamps. Runs in both wall orientations.

const NEW_STAMPS = ['house', 'tree', 'rocket', 'car', 'butterfly'] as const;

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

const inkPixels = (page: Page) =>
	page.getByTestId('draw-canvas').evaluate((c: HTMLCanvasElement) => {
		const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
		let n = 0;
		for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
		return n;
	});

async function drag(page: Page, from: [number, number], to: [number, number], id: number) {
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
						bubbles: true,
						clientX: r.left + r.width * x,
						clientY: r.top + r.height * y
					})
				);
			fire('pointerdown', a.from[0], a.from[1]);
			fire('pointermove', (a.from[0] + a.to[0]) / 2, (a.from[1] + a.to[1]) / 2);
			fire('pointermove', a.to[0], a.to[1]);
			fire('pointerup', a.to[0], a.to[1]);
		},
		{ from, to, id }
	);
}

test('the five new stamps place with ink and undo', async ({ page }, info) => {
	const kidId = `e2e-draw-stamps-${info.workerIndex}${info.repeatEachIndex}`;
	seedKid(kidId, 'Kid Stamps');
	try {
		await gotoHydrated(page, '/');
		await page.getByTestId('note-draw').click();
		const canvas = page.getByTestId('draw-canvas');
		for (const kind of NEW_STAMPS) {
			await page.getByTestId('draw-shapes-open').click();
			const pick = page.getByTestId('draw-shape').and(page.locator(`[data-shape="${kind}"]`));
			await expectTappable(pick, 96);
			await pick.click();
			await drag(page, [0.2, 0.2], [0.6, 0.7], 1);
			await expect(canvas).toHaveAttribute('data-strokes', '1');
			expect(await inkPixels(page)).toBeGreaterThan(200);
			await page.getByTestId('draw-undo').click();
			await expect(canvas).toHaveAttribute('data-strokes', '0');
			expect(await inkPixels(page)).toBe(0);
		}
	} finally {
		wipe(kidId);
	}
});
