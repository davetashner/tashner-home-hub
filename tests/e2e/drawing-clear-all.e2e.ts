import { expect, test, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { ensureHousehold } from './adult';
import { gotoHydrated } from './hydrated';
import { trackMember } from './cleanup';
import { DB_PATH } from './data-dir';
import { expectTappable } from './tap';

// hub-cn7.12: Clear all resets the whole board; Undo clear, Undo and Redo bring it back.

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

async function stroke(page: Page, from: [number, number], to: [number, number]) {
	await page.getByTestId('draw-canvas').evaluate(
		(c, a) => {
			const r = c.getBoundingClientRect();
			const fire = (name: string, x: number, y: number) =>
				c.dispatchEvent(
					new PointerEvent(name, {
						pointerId: 1,
						pointerType: 'pen',
						pressure: 0.9,
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

test('Clear all resets the board and Undo clear, Undo and Redo restore it @J18.14', async ({
	page
}, info) => {
	const tag = `c${Date.now().toString(36)}${info.workerIndex}${info.repeatEachIndex}`;
	seedKid(`e2e-clear-kid-${tag}`, `Kid ${tag}`);
	await gotoHydrated(page, '/');
	await page.getByTestId('note-draw').click();
	const canvas = page.getByTestId('draw-canvas');
	const holder = page.getByTestId('draw-holder');
	await expect(page.getByTestId('draw-clear')).toBeDisabled();
	await expect(page.getByTestId('draw-redo')).toBeDisabled();
	await expectTappable(page.getByTestId('draw-clear'), 96);
	await expectTappable(page.getByTestId('draw-redo'), 96);

	// A page alone is enough to enable Clear all.
	await page.getByTestId('draw-pages-open').click();
	await page.getByTestId('draw-page').first().click();
	await expect(canvas).not.toHaveAttribute('data-page', '');
	await expect(page.getByTestId('draw-clear')).toBeEnabled();

	// Ink, a background, then clear everything.
	await page.getByTestId('draw-bg-open').click();
	await page.getByTestId('draw-bg-color').nth(5).click();
	await stroke(page, [0.1, 0.2], [0.8, 0.3]);
	await expect(canvas).toHaveAttribute('data-strokes', '1');
	const pageId = await canvas.getAttribute('data-page');
	const bg = await holder.getAttribute('data-bg');
	expect(bg).not.toBe('');

	await page.getByTestId('draw-clear').click();
	await expect(canvas).toHaveAttribute('data-strokes', '0');
	await expect(canvas).toHaveAttribute('data-page', '');
	await expect(holder).toHaveAttribute('data-bg', '');
	await expect(page.getByTestId('draw-clear')).toBeDisabled();

	// The toast puts back the exact board.
	await expectTappable(page.getByTestId('draw-undo-clear'), 96);
	await page.getByTestId('draw-undo-clear').click();
	await expect(canvas).toHaveAttribute('data-strokes', '1');
	await expect(canvas).toHaveAttribute('data-page', pageId!);
	await expect(holder).toHaveAttribute('data-bg', bg!);
	await expect(page.getByTestId('draw-undo-clear')).toHaveCount(0);

	// Redo clears again; a new stroke empties the redo stack.
	await page.getByTestId('draw-redo').click();
	await expect(canvas).toHaveAttribute('data-strokes', '0');
	await expect(canvas).toHaveAttribute('data-page', '');
	await page.getByTestId('draw-undo').click();
	await expect(canvas).toHaveAttribute('data-strokes', '1');
	await page.getByTestId('draw-clear').click();
	await page.getByTestId('draw-undo').click(); // plain Undo restores a clear too
	await expect(canvas).toHaveAttribute('data-page', pageId!);
	await page.getByTestId('draw-undo').click(); // and the next one takes the stroke back
	await expect(canvas).toHaveAttribute('data-strokes', '0');
	await expect(page.getByTestId('draw-redo')).toBeEnabled();
	await stroke(page, [0.2, 0.5], [0.7, 0.6]);
	await expect(page.getByTestId('draw-redo')).toBeDisabled();
});
