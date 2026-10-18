import { expect, test } from '@playwright/test';
import { startTimer, type KitchenTimer } from '../../src/lib/domain/timers';
import { ensureHousehold } from './adult';
import { stubAudio } from './kid';
import { expectTappable } from './tap';
import { gotoHydrated } from './hydrated';
import { fakeTimerApi } from './timers-api';

// TMR-1: kitchen timers. The projects share one database, and a timer firing in it would put a
// banner over every other spec's screen, so /api/timers is answered by an in-memory stand-in here.
// The real storage and routes are covered by src/routes/api/timers.spec.ts.
test.use({ serviceWorkers: 'block' });
test.beforeAll(ensureHousehold);

test('start, pause, add a minute and cancel timers; the pill follows along', async ({ page }) => {
	const timers: KitchenTimer[] = [];
	await fakeTimerApi(page, timers);
	await gotoHydrated(page, '/');
	await expectTappable(page.getByTestId('timer-open'));
	await page.getByTestId('timer-open').click();
	await page.getByTestId('timer-preset-3').click();
	await page.getByRole('button', { name: '+5', exact: true }).click();
	await expect(page.getByTestId('timer-pending')).toHaveText('8 min');
	await page.getByTestId('timer-preset-1').click();
	await page.getByRole('button', { name: 'Pasta', exact: true }).click();
	await page.getByTestId('timer-start').click();
	await expect(page.getByTestId('timer-row')).toHaveCount(1);
	await expect(page.getByTestId('timer-row')).toContainText('Pasta');

	await page.getByTestId('timer-pause').click();
	await expect(page.getByTestId('timer-row')).toContainText('Paused');
	await page.getByTestId('timer-pause').click();
	await page.getByRole('button', { name: '+1 min' }).click();
	await expect(page.getByTestId('timer-row-time')).toHaveText(/^(1:5\d|2:00)$/);
	await page.getByTestId('timer-close').click();

	// The pill stays on screen across tabs and survives a reload.
	await page.getByTestId('timer-pill').first().waitFor();
	await gotoHydrated(page, '/lists');
	await expect(page.getByTestId('timer-pill')).toHaveCount(1);
	await page.getByTestId('timer-pill').click();
	await page.getByTestId('timer-cancel').click();
	await expect(page.getByTestId('timer-pill')).toHaveCount(0);
	expect(timers).toHaveLength(0);
});

test('a finished timer shows a banner, sounds the alarm and is dismissed', async ({ page }) => {
	await page.addInitScript(
		() => ((window as unknown as { __hubSounds: unknown[] }).__hubSounds = [])
	);
	await stubAudio(page);
	const timers = [startTimer('e2e-pasta-timer', 2000, 'Pasta', Date.now())];
	await fakeTimerApi(page, timers);
	await gotoHydrated(page, '/');
	await expect(page.getByTestId('timer-pill')).toHaveCount(1);
	await expect(page.getByTestId('timer-banner')).toContainText('Pasta is done', {
		timeout: 10_000
	});
	const sounds = () =>
		page.evaluate(() => (window as unknown as { __hubSounds: { kind: string }[] }).__hubSounds);
	await expect.poll(async () => (await sounds()).some((s) => s.kind === 'alarm')).toBe(true);
	await expectTappable(page.getByTestId('timer-dismiss'), 96);

	await page.getByTestId('timer-dismiss').click();
	await expect(page.getByTestId('timer-banner')).toHaveCount(0);
	expect(timers).toHaveLength(0);
});
