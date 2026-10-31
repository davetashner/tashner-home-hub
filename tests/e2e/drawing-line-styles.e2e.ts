import { expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { ensureHousehold } from './adult';
import { gotoHydrated } from './hydrated';
import { expectTappable } from './tap';
import { trackMember } from './cleanup';
import { DB_PATH } from './data-dir';

// hub-cn7.17: dashed and dotted outlines, applied to the next shape and to the selected one.
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

test('line styles are big targets, change the ink and restyle the selection @J18.4', async ({
	page
}, info) => {
	seedKid(`e2e-draw-dash-${info.workerIndex}${info.repeatEachIndex}`, 'Kid Line Styles');
	await gotoHydrated(page, '/');
	await page.getByTestId('note-draw').click();
	const canvas = page.getByTestId('draw-canvas');
	await page.getByTestId('draw-shapes-open').click();
	const style = (v: string) =>
		page.getByTestId('draw-line-style').and(page.locator(`[data-style="${v}"]`));
	for (const v of ['solid', 'dashed', 'dotted']) {
		await style(v).scrollIntoViewIfNeeded();
		await expectTappable(style(v), 96);
	}
	await expect(style('solid')).toHaveAttribute('aria-pressed', 'true');
	await style('dashed').click();
	await expect(style('dashed')).toHaveAttribute('aria-pressed', 'true');
	await page.getByTestId('draw-shape').and(page.locator('[data-shape="square"]')).click();
	await canvas.click({ position: { x: 240, y: 200 } });
	await expect(canvas).toHaveAttribute('data-strokes', '1');
	await page.getByTestId('draw-undo').click();
	await expect(canvas).toHaveAttribute('data-strokes', '0');
});
