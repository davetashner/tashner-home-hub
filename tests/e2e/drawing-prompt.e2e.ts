import { expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { ensureHousehold, signInAsAdult } from './adult';
import { gotoHydrated } from './hydrated';
import { expectTappable } from './tap';
import { DB_PATH } from './data-dir';

// hub-cn7.27: a daily drawing prompt at the top of the board, with Shuffle, Hide and an adult setting.
// The setting is shared household state and both wall projects run at once, so the board test
// feeds the setting through a route instead of reading what another project may be changing.

function resetPrompts() {
	const db = new Database(DB_PATH);
	db.pragma('busy_timeout = 5000');
	db.prepare("DELETE FROM settings WHERE key = 'drawing.prompts'").run();
	db.close();
}

const DATE = '2026-10-31';

test('the prompt shows, shuffles and hides for the day @J18.16', async ({ page }) => {
	ensureHousehold();
	await page.route('**/api/settings/drawing-prompts', (route) =>
		route.fulfill({ json: { enabled: true, date: DATE } })
	);
	await gotoHydrated(page, '/');
	await page.getByTestId('note-draw').click();
	const prompt = page.getByTestId('draw-prompt');
	await expect(prompt).toBeVisible();
	await expectTappable(page.getByTestId('draw-prompt-shuffle'), 96);
	await expectTappable(page.getByTestId('draw-prompt-hide'), 96);

	const first = await prompt.innerText();
	await page.getByTestId('draw-prompt-shuffle').click();
	await expect(prompt).not.toHaveText(first);

	await page.getByTestId('draw-prompt-hide').click();
	await expect(page.getByTestId('draw-prompt-banner')).toHaveCount(0);

	// Hidden for the rest of the day: reopening the board keeps it away.
	await page.getByTestId('draw-close').click();
	await page.getByTestId('note-draw').click();
	await expect(page.getByTestId('draw-sheet')).toBeVisible();
	await expect(page.getByTestId('draw-prompt-banner')).toHaveCount(0);
});

test('no banner when a grown-up has turned prompts off @J18.16', async ({ page }) => {
	ensureHousehold();
	await page.route('**/api/settings/drawing-prompts', (route) =>
		route.fulfill({ json: { enabled: false, date: DATE } })
	);
	await gotoHydrated(page, '/');
	await page.getByTestId('note-draw').click();
	await expect(page.getByTestId('draw-sheet')).toBeVisible();
	await expect(page.getByTestId('draw-canvas')).toBeVisible();
	await expect(page.getByTestId('draw-prompt-banner')).toHaveCount(0);
});

test('a grown-up turns prompts off and on in Settings > Drawing @J18.16', async ({ page }) => {
	ensureHousehold();
	try {
		await signInAsAdult(page, 'e2e-baseline-adult');
		await gotoHydrated(page, '/settings/drawing');
		const saved = page.waitForResponse(
			(r) => r.url().includes('/api/settings/drawing-prompts') && r.request().method() === 'PUT'
		);
		await page.getByRole('button', { name: 'Off' }).click();
		expect(await (await saved).json()).toEqual({ enabled: false });
		await expect(page.getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'true');
	} finally {
		resetPrompts();
	}
});
