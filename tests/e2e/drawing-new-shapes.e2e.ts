import { expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { ensureHousehold } from './adult';
import { gotoHydrated } from './hydrated';
import { expectTappable } from './tap';
import { trackMember } from './cleanup';
import { DB_PATH } from './data-dir';

// hub-cn7.15: ten new shapes in the picker, placeable, filled and undoable.
const NEW = [
	'oval',
	'diamond',
	'pentagon',
	'hexagon',
	'rounded',
	'moon',
	'cloud',
	'bolt',
	'rainbow',
	'doublearrow'
];

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

test('every new shape is a big tap target, places ink, fills and undoes @J18.4', async ({
	page
}, info) => {
	seedKid(`e2e-draw-new-${info.workerIndex}${info.repeatEachIndex}`, 'Kid New Shapes');
	await gotoHydrated(page, '/');
	await page.getByTestId('note-draw').click();
	const canvas = page.getByTestId('draw-canvas');
	for (const k of NEW) {
		await page.getByTestId('draw-shapes-open').click();
		const btn = page.getByTestId('draw-shape').and(page.locator(`[data-shape="${k}"]`));
		await btn.scrollIntoViewIfNeeded();
		await expectTappable(btn, 96);
		await btn.click();
		await canvas.click({ position: { x: 200, y: 160 } });
	}
	await expect(canvas).toHaveAttribute('data-strokes', String(NEW.length));
	await page.getByTestId('draw-undo').click();
	await expect(canvas).toHaveAttribute('data-strokes', String(NEW.length - 1));
});
