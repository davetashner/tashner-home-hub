import { expect, test, type Page } from '@playwright/test';
import { ensureHousehold, signInAsAdult } from './adult';
import { choreCard, openKid, seedKid, stubAudio } from './kid';
import { expectTappable } from './tap';

test.use({ serviceWorkers: 'block' });
test.beforeAll(ensureHousehold);

type Played = { theme: string; kind: string; volume: number };
const hook = (page: Page) =>
	page.addInitScript(() => ((window as unknown as { __hubSounds: unknown[] }).__hubSounds = []));
const played = (page: Page) =>
	page.evaluate(() => (window as unknown as { __hubSounds: Played[] }).__hubSounds);

/** Quiet 22:00 to 06:00 in Tokyo; the household zone, not the browser's, decides. */
async function kidDay(page: Page, label: string, at: string) {
	await hook(page);
	await stubAudio(page);
	await page.route('**/api/settings/sound', (route) =>
		route.fulfill({
			json: {
				muted: false,
				quietStart: '22:00',
				quietEnd: '06:00',
				theme: 'arcade',
				volume: 60,
				timeZone: 'Asia/Tokyo'
			}
		})
	);
	const settings = page.waitForResponse('**/api/settings/sound');
	const s = await seedKid(page, label);
	await openKid(page, s);
	await settings;
	await page.clock.setFixedTime(new Date(at));
	await choreCard(page, 'Brush teeth').getByTestId('did-it').click();
	await expect(page.getByTestId('flying-star')).toHaveCount(1);
}

test('quiet hours in the household zone keep a celebration silent', async ({ page }, info) => {
	await kidDay(page, `quiet ${info.project.name}`, '2026-10-17T14:30:00Z'); // 23:30 in Tokyo
	await page.waitForTimeout(300);
	expect(await played(page)).toEqual([]);
});

test('outside quiet hours the chosen theme and volume play', async ({ page }, info) => {
	await kidDay(page, `loud ${info.project.name}`, '2026-10-17T03:00:00Z'); // noon in Tokyo
	await expect.poll(() => played(page)).toEqual([{ theme: 'arcade', kind: 'tap', volume: 60 }]);
});

test('grown-ups pick a theme and volume, preview it, and it persists', async ({ page }, info) => {
	await hook(page);
	await signInAsAdult(page, `e2e-theme-adult-${info.project.name}`);
	await page.goto('/settings/sound');
	const arcade = page.getByRole('button', { name: 'Arcade', exact: true });
	await expect(async () => {
		await arcade.click();
		await expect(arcade).toHaveAttribute('aria-pressed', 'true', { timeout: 500 });
	}).toPass();
	await expectTappable(arcade);
	const slider = page.getByRole('slider', { name: 'Volume' });
	await slider.fill('35');
	await expect(page.getByTestId('volume')).toHaveText('35%');

	const preview = page.getByRole('button', { name: 'Preview' });
	await expectTappable(preview);
	await preview.click();
	await expect.poll(() => played(page)).toEqual([{ theme: 'arcade', kind: 'fanfare', volume: 35 }]);

	await expect
		.poll(async () => (await (await page.request.get('/api/settings/sound')).json()).volume)
		.toBe(35);
	await page.reload();
	await expect(page.getByRole('button', { name: 'Arcade', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(page.getByTestId('volume')).toHaveText('35%');
});
