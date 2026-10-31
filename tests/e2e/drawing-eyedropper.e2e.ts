import { expect, test, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { ensureHousehold } from './adult';
import { gotoHydrated } from './hydrated';
import { expectTappable } from './tap';
import { trackMember } from './cleanup';
import { DB_PATH } from './data-dir';

// hub-cn7.14: the eyedropper picks the composited color under the finger and becomes the ink.

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

type Pt = [number, number];

/** Pointer events on the canvas at fractional positions; `hold` leaves the pointer down. */
async function touch(page: Page, pts: Pt[], hold = false) {
	await page.getByTestId('draw-canvas').evaluate(
		(c, a) => {
			const r = c.getBoundingClientRect();
			const fire = (name: string, p: Pt) =>
				c.dispatchEvent(
					new PointerEvent(name, {
						pointerId: 1,
						pointerType: 'pen',
						pressure: 0.8,
						isPrimary: true,
						button: 0,
						buttons: name === 'pointerup' ? 0 : 1,
						clientX: r.left + p[0] * r.width,
						clientY: r.top + p[1] * r.height,
						bubbles: true
					})
				);
			fire('pointerdown', a.pts[0]);
			for (const p of a.pts.slice(1)) fire('pointermove', p);
			if (!a.hold) fire('pointerup', a.pts[a.pts.length - 1]);
		},
		{ pts, hold }
	);
}

const release = (page: Page, p: Pt) =>
	page.getByTestId('draw-canvas').evaluate((c, at) => {
		const r = c.getBoundingClientRect();
		c.dispatchEvent(
			new PointerEvent('pointerup', {
				pointerId: 1,
				pointerType: 'pen',
				isPrimary: true,
				button: 0,
				clientX: r.left + r.width * at[0],
				clientY: r.top + r.height * at[1],
				bubbles: true
			})
		);
	}, p);

test('eyedropper picks the board color, joins recents, and returns to drawing', async ({
	page
}, info) => {
	const kidId = `e2e-dropper-kid-${info.workerIndex}${info.repeatEachIndex}`;
	seedKid(kidId, 'Kid Dropper');
	await gotoHydrated(page, '/');
	await page.getByTestId('note-draw').click();
	const btn = page.getByTestId('draw-eyedropper');
	await expectTappable(btn, 96);

	// A red stroke across the middle of the board.
	await page.getByRole('button', { name: 'red', exact: true }).click();
	await touch(page, [
		[0.2, 0.5],
		[0.5, 0.5],
		[0.8, 0.5]
	]);
	await page.getByRole('button', { name: 'black', exact: true }).click();

	await btn.click();
	await expect(btn).toHaveAttribute('aria-pressed', 'true');
	const preview = page.getByTestId('draw-dropper-preview');

	// Bare paper first: the preview shows the paper color while the finger is down.
	await touch(page, [[0.1, 0.1]], true);
	await expect(preview).toBeVisible();
	const paper = await preview.getAttribute('data-color');
	expect(paper).toMatch(/^rgb\(/);

	// Drag onto the stroke: the preview follows, and releasing commits.
	await page.getByTestId('draw-canvas').evaluate((c) => {
		const r = c.getBoundingClientRect();
		c.dispatchEvent(
			new PointerEvent('pointermove', {
				pointerId: 1,
				pointerType: 'pen',
				isPrimary: true,
				buttons: 1,
				clientX: r.left + r.width * 0.5,
				clientY: r.top + r.height * 0.5,
				bubbles: true
			})
		);
	});
	await expect(preview).not.toHaveAttribute('data-color', paper!);
	const red = (await preview.getAttribute('data-color'))!;
	await release(page, [0.5, 0.5]);
	await expect(preview).toHaveCount(0);
	await expect(btn).toHaveAttribute('aria-pressed', 'false');

	// The picked color is the first recent color; picking drew nothing.
	const channels = red.match(/\d+/g)!.join(', ');
	await expect(page.getByTestId('draw-recent').first()).toHaveAttribute(
		'style',
		new RegExp(`rgb\\(${channels}\\)`)
	);
	await expect(page.getByTestId('draw-canvas')).toHaveAttribute('data-strokes', '1');

	// Drawing resumes with the picked ink.
	await touch(page, [
		[0.2, 0.2],
		[0.6, 0.3]
	]);
	await expect(page.getByTestId('draw-canvas')).toHaveAttribute('data-strokes', '2');
});
