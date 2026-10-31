import { expect, test, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { ensureHousehold } from './adult';
import { gotoHydrated } from './hydrated';
import { expectTappable } from './tap';
import { trackMember } from './cleanup';
import { DB_PATH } from './data-dir';

// hub-cn7.25: flipbook frames, each with its own undo history, and an onion skin of the previous one.

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

const inkOn = (page: Page, testId: string) =>
	page.getByTestId(testId).evaluate((c: HTMLCanvasElement) => {
		const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
		let n = 0;
		for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
		return n;
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

test('flipbook frames keep their own ink and history, with an onion skin', async ({
	page
}, info) => {
	seedKid(`e2e-flip-kid-${info.workerIndex}${info.repeatEachIndex}`, 'Kid Flip');
	await gotoHydrated(page, '/');
	await page.getByTestId('note-draw').click();
	const toggle = page.getByTestId('draw-flipbook');
	await expectTappable(toggle, 96);
	await expect(page.getByTestId('flip-strip')).toHaveCount(0);

	// The ink already on the board becomes frame 1.
	await stroke(page, [0.1, 0.1], [0.4, 0.3]);
	await toggle.click();
	await expect(page.getByTestId('flip-frame')).toHaveCount(1);
	for (const id of [
		'flip-add',
		'flip-copy',
		'flip-delete',
		'flip-earlier',
		'flip-later',
		'flip-onion'
	])
		await expectTappable(page.getByTestId(id), 96);
	await expectTappable(page.getByTestId('flip-frame').first(), 96);

	// A new frame is blank, with frame 1 faint underneath.
	await page.getByTestId('flip-add').click();
	await expect(page.getByTestId('flip-frame')).toHaveCount(2);
	await expect(page.getByTestId('draw-canvas')).toHaveAttribute('data-strokes', '0');
	await expect(page.getByTestId('draw-onion')).toHaveAttribute('data-onion', 'true');
	expect(await inkOn(page, 'draw-onion')).toBeGreaterThan(0);
	await page.getByTestId('flip-onion').click();
	expect(await inkOn(page, 'draw-onion')).toBe(0);
	await page.getByTestId('flip-onion').click();
	expect(await inkOn(page, 'draw-onion')).toBeGreaterThan(0);

	// Undo works per frame: frame 2's stroke goes, frame 1's stays.
	await stroke(page, [0.5, 0.5], [0.9, 0.8]);
	await expect(page.getByTestId('draw-canvas')).toHaveAttribute('data-strokes', '1');
	await page.getByTestId('flip-frame').first().click();
	await expect(page.getByTestId('draw-canvas')).toHaveAttribute('data-strokes', '1');
	await expect(page.getByTestId('draw-onion')).toHaveAttribute('data-onion', 'false');
	await expect(page.getByTestId('draw-undo')).toBeEnabled();
	await page.getByTestId('draw-undo').click();
	await expect(page.getByTestId('draw-canvas')).toHaveAttribute('data-strokes', '0');
	await page.getByTestId('flip-frame').nth(1).click();
	await expect(page.getByTestId('draw-canvas')).toHaveAttribute('data-strokes', '1');
	await expect(page.getByTestId('draw-undo')).toBeEnabled();

	// Copy, reorder, delete.
	await page.getByTestId('flip-copy').click();
	await expect(page.getByTestId('flip-frame')).toHaveCount(3);
	await expect(page.getByTestId('draw-canvas')).toHaveAttribute('data-strokes', '1');
	await expect(page.getByTestId('draw-undo')).toBeDisabled();
	await page.getByTestId('flip-earlier').click();
	await expect(page.getByTestId('flip-frame').nth(1)).toHaveAttribute('aria-pressed', 'true');
	await page.getByTestId('flip-delete').click();
	await expect(page.getByTestId('flip-frame')).toHaveCount(2);

	// Frames survive leaving and re-entering the mode.
	await toggle.click();
	await expect(page.getByTestId('flip-strip')).toHaveCount(0);
	await toggle.click();
	await expect(page.getByTestId('flip-frame')).toHaveCount(2);
});

test('flipbook stops at 24 frames', async ({ page }, info) => {
	seedKid(`e2e-flip-max-${info.workerIndex}${info.repeatEachIndex}`, 'Kid Max');
	await gotoHydrated(page, '/');
	await page.getByTestId('note-draw').click();
	await page.getByTestId('draw-flipbook').click();
	for (let i = 1; i < 24; i++) await page.getByTestId('flip-add').click();
	await expect(page.getByTestId('flip-frame')).toHaveCount(24);
	await expect(page.getByTestId('flip-add')).toBeDisabled();
	await expect(page.getByTestId('flip-copy')).toBeDisabled();
});
