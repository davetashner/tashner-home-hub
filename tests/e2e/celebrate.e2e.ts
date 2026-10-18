import { expect, test } from '@playwright/test';
import { choreCard, openKid, seedKid, stubAudio } from './kid';
import { reloadHydrated } from './hydrated';

const outlineStars = (page: import('@playwright/test').Page) =>
	page.getByTestId('jar-glass').locator('[data-star="outline"]');

test('tap: stars fly to the jar and land as pending, with sound @J1.2', async ({ page }, info) => {
	const notes = await stubAudio(page);
	const s = await seedKid(page, `fly ${info.project.name}`);
	await openKid(page, s);
	await choreCard(page, 'Feed the fish').getByTestId('did-it').click(); // 3 stars; not the last chore
	await expect(page.getByTestId('flying-star')).toHaveCount(3, { timeout: 500 });
	await expect(outlineStars(page)).toHaveCount(3);
	await expect(page.getByTestId('flying-star')).toHaveCount(0, { timeout: 4000 });
	await expect(outlineStars(page).first()).toHaveCSS('opacity', '1', { timeout: 2000 });
	expect(await notes()).toBeGreaterThan(0);
});

test('all done: banner after the last chore, once per day @J1.6', async ({ page }, info) => {
	const s = await seedKid(page, `alldone ${info.project.name}`);
	await openKid(page, s);
	await choreCard(page, 'Brush teeth').getByTestId('did-it').click();
	await page.waitForTimeout(1300);
	await expect(page.getByTestId('all-done')).toHaveCount(0);
	await choreCard(page, 'Feed the fish').getByTestId('did-it').click();
	await expect(page.getByTestId('all-done')).toContainText('All done today!');
	await expect(page.getByTestId('all-done')).toHaveCount(0, { timeout: 5000 });
	await reloadHydrated(page); // remembered in localStorage: no second party
	await expect(page.getByTestId('star-jar')).toBeVisible();
	await page.waitForTimeout(500);
	await expect(page.getByTestId('all-done')).toHaveCount(0);
});

test('reduced motion: no flight, a gentle fade, sound still plays @J1.2', async ({
	page
}, info) => {
	await page.emulateMedia({ reducedMotion: 'reduce' });
	const notes = await stubAudio(page);
	const s = await seedKid(page, `reduced ${info.project.name}`);
	await openKid(page, s);
	await choreCard(page, 'Brush teeth').getByTestId('did-it').click();
	await expect(outlineStars(page)).toHaveCount(1);
	await page.waitForTimeout(400);
	await expect(page.getByTestId('flying-star')).toHaveCount(0);
	expect(await notes()).toBeGreaterThan(0);
});

test('muted: no sound is made @J1.2', async ({ page }, info) => {
	const notes = await stubAudio(page);
	await page.route('**/api/settings/sound', (route) =>
		route.fulfill({ json: { muted: true, quietStart: '20:00', quietEnd: '07:00' } })
	);
	const settings = page.waitForResponse('**/api/settings/sound');
	const s = await seedKid(page, `muted ${info.project.name}`);
	await openKid(page, s);
	await settings;
	await choreCard(page, 'Brush teeth').getByTestId('did-it').click();
	await expect(page.getByTestId('flying-star')).toHaveCount(1);
	expect(await notes()).toBe(0);
});

test('approval: a grown-up approving rings a ding and pops the gold star @J3.2', async ({
	page
}, info) => {
	const notes = await stubAudio(page);
	const s = await seedKid(page, `approve ${info.project.name}`);
	const done = await (
		await page.request.post(`/api/chores/${s.chores['Brush teeth']}/complete`, {
			data: { memberId: s.memberId }
		})
	).json();
	await openKid(page, s);
	await expect(page.getByTestId('jar-counts')).toContainText('2 gold stars, 1 waiting');
	expect(await notes()).toBe(0);
	await page.request.post(`/api/completions/${done.completion.id}/approve`, { data: {} });
	await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
	await expect(page.getByTestId('jar-counts')).toContainText('3 gold stars, 0 waiting');
	await expect.poll(notes).toBeGreaterThan(0);
});
