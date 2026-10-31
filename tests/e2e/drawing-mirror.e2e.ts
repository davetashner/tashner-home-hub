import { expect, test, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { ensureHousehold } from './adult';
import { gotoHydrated } from './hydrated';
import { expectTappable } from './tap';
import { trackMember } from './cleanup';
import { DB_PATH } from './data-dir';

// hub-cn7.18: mirror mode draws every stroke in 2, 4 or 8 places, as one undo step.

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

/** Which quadrants (tl, tr, bl, br) of the canvas hold ink. */
const quadrants = (page: Page) =>
	page.getByTestId('draw-canvas').evaluate((c: HTMLCanvasElement) => {
		const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
		const hit = [false, false, false, false];
		for (let y = 0; y < c.height; y++)
			for (let x = 0; x < c.width; x++)
				if (d[(y * c.width + x) * 4 + 3] > 0)
					hit[(y < c.height / 2 ? 0 : 2) + (x < c.width / 2 ? 0 : 1)] = true;
		return hit;
	});

async function stroke(page: Page, from: [number, number], to: [number, number]) {
	await page.getByTestId('draw-canvas').evaluate(
		(c, a) => {
			const r = c.getBoundingClientRect();
			const fire = (name: string, x: number, y: number) =>
				c.dispatchEvent(
					new PointerEvent(name, {
						pointerId: 1,
						pointerType: 'pen',
						pressure: 0.8,
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
		{ from, to }
	);
}

test('mirror mode draws a stroke in every quadrant as one undo step', async ({ page }, info) => {
	const kidId = `e2e-mirror-kid-${info.workerIndex}${info.repeatEachIndex}`;
	seedKid(kidId, 'Kid Mirror');
	await gotoHydrated(page, '/');
	await page.getByTestId('note-draw').click();
	const btn = page.getByTestId('draw-mirror');
	await expectTappable(btn, 96);
	await expect(btn).toHaveAttribute('data-mirror', '0');
	await expect(page.getByTestId('draw-mirror-guides')).toHaveCount(0);

	// Off: one quadrant only.
	await stroke(page, [0.1, 0.1], [0.4, 0.3]);
	expect(await quadrants(page)).toEqual([true, false, false, false]);
	await page.getByTestId('draw-undo').click();

	// 2-way: left and right.
	await btn.click();
	await expect(btn).toHaveAttribute('data-mirror', '2');
	await expect(page.getByTestId('draw-mirror-guides')).toBeVisible();
	await stroke(page, [0.1, 0.1], [0.4, 0.3]);
	expect(await quadrants(page)).toEqual([true, true, false, false]);
	await page.getByTestId('draw-undo').click();

	// 4-way: all four, and one undo removes them all.
	await btn.click();
	await expect(btn).toHaveAttribute('data-mirror', '4');
	await stroke(page, [0.1, 0.1], [0.4, 0.3]);
	await expect(page.getByTestId('draw-canvas')).toHaveAttribute('data-strokes', '1');
	expect(await quadrants(page)).toEqual([true, true, true, true]);
	await page.getByTestId('draw-undo').click();
	expect(await quadrants(page)).toEqual([false, false, false, false]);

	// 8-way then off again.
	await btn.click();
	await expect(btn).toHaveAttribute('data-mirror', '8');
	await stroke(page, [0.1, 0.1], [0.4, 0.3]);
	expect(await quadrants(page)).toEqual([true, true, true, true]);
	await btn.click();
	await expect(btn).toHaveAttribute('data-mirror', '0');
});
