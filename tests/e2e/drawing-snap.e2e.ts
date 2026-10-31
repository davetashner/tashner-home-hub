import { expect, test, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { ensureHousehold } from './adult';
import { gotoHydrated } from './hydrated';
import { trackMember } from './cleanup';
import { DB_PATH } from './data-dir';
import { expectTappable } from './tap';

// hub-cn7.21: shape snapping is off by default, remembered per device, and always reversible.

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

/** A hand-drawn loop (fractions of the canvas), closing with a small overshoot. */
async function drawCircle(page: Page) {
	await page.getByTestId('draw-canvas').evaluate((c) => {
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
					clientX: r.left + x,
					clientY: r.top + y,
					bubbles: true
				})
			);
		const rad = Math.min(r.width, r.height) * 0.25;
		const at = (i: number) => {
			const t = (i / 40) * Math.PI * 2.08 - Math.PI / 2;
			const wob = 1 + Math.sin(i * 2.1) * 0.015;
			return [r.width / 2 + rad * wob * Math.cos(t), r.height / 2 + rad * wob * Math.sin(t)];
		};
		fire('pointerdown', at(0)[0], at(0)[1]);
		for (let i = 1; i <= 40; i++) fire('pointermove', at(i)[0], at(i)[1]);
		fire('pointerup', at(40)[0], at(40)[1]);
	});
}

async function scribble(page: Page) {
	await page.getByTestId('draw-canvas').evaluate((c) => {
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
					clientX: r.left + x,
					clientY: r.top + y,
					bubbles: true
				})
			);
		fire('pointerdown', 100, 100);
		for (let i = 1; i <= 30; i++)
			fire('pointermove', 100 + (i % 2) * 120, 100 + i * 9 + ((i * 7) % 5));
		fire('pointerup', 100, 380);
	});
}

test('Snap is off by default, remembered, and every snap can be kept or undone @J18.17', async ({
	page
}, info) => {
	const tag = `s${Date.now().toString(36)}${info.workerIndex}${info.repeatEachIndex}`;
	seedKid(`e2e-snap-kid-${tag}`, `Kid ${tag}`);
	await gotoHydrated(page, '/');
	await page.getByTestId('note-draw').click();
	const canvas = page.getByTestId('draw-canvas');
	const snap = page.getByTestId('draw-snap');
	await expectTappable(snap, 96);

	// Off: a loop stays the child's line.
	await expect(snap).toHaveAttribute('aria-pressed', 'false');
	await drawCircle(page);
	await expect(canvas).toHaveAttribute('data-last', 'stroke');
	await expect(page.getByTestId('draw-keep-line')).toHaveCount(0);

	// On: the same loop becomes a circle, and the choice is remembered on reload.
	await snap.click();
	await expect(snap).toHaveAttribute('aria-pressed', 'true');
	await drawCircle(page);
	await expect(canvas).toHaveAttribute('data-last', 'circle');
	await expect(canvas).toHaveAttribute('data-strokes', '2');
	await expectTappable(page.getByTestId('draw-keep-line'), 96);

	// Keep my line brings the raw stroke back.
	await page.getByTestId('draw-keep-line').click();
	await expect(canvas).toHaveAttribute('data-last', 'stroke');
	await expect(canvas).toHaveAttribute('data-strokes', '2');
	await expect(page.getByTestId('draw-keep-line')).toHaveCount(0);

	// Undo after a snap restores the original stroke, not an empty board; a second Undo removes it.
	await page.getByTestId('draw-redo').click();
	await expect(canvas).toHaveAttribute('data-last', 'circle');
	await page.getByTestId('draw-undo').click();
	await expect(canvas).toHaveAttribute('data-last', 'stroke');
	await expect(canvas).toHaveAttribute('data-strokes', '2');
	await page.getByTestId('draw-undo').click();
	await expect(canvas).toHaveAttribute('data-strokes', '1');

	// A scribble never snaps, and the chip goes away by itself.
	await scribble(page);
	await expect(canvas).toHaveAttribute('data-last', 'stroke');
	await expect(page.getByTestId('draw-keep-line')).toHaveCount(0);
	await drawCircle(page);
	await expect(page.getByTestId('draw-keep-line')).toBeVisible();
	await expect(page.getByTestId('draw-keep-line')).toHaveCount(0, { timeout: 8000 });
	await expect(canvas).toHaveAttribute('data-last', 'circle');

	await page.reload();
	await page.getByTestId('note-draw').click();
	await expect(page.getByTestId('draw-snap')).toHaveAttribute('aria-pressed', 'true');
	await page.getByTestId('draw-snap').click();
	await expect(page.getByTestId('draw-snap')).toHaveAttribute('aria-pressed', 'false');
});
