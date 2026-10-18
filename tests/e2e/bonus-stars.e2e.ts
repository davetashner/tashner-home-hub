import { expect, test, type Page } from '@playwright/test';
import { expectTappable } from './tap';
import { openKid, seedKid, stubAudio } from './kid';
import { gotoHydrated } from './hydrated';

async function balance(page: Page, memberId: string): Promise<number> {
	return (await (await page.request.get(`/api/members/${memberId}/stars`)).json()).balance;
}

async function openStars(page: Page, memberId: string) {
	await gotoHydrated(page, '/settings/stars');
	await page.locator(`[data-testid="stars-member"][data-member="${memberId}"]`).click();
}

async function giveAndRemove(page: Page, label: string) {
	const s = await seedKid(page, `bonus ${label}`); // 2 stars
	await openStars(page, s.memberId);
	await expect(page.getByTestId('stars-balance')).toContainText('has 2 ⭐');

	// Give +2 with a quick reason.
	await expectTappable(page.getByTestId('amount').first());
	await page.getByTestId('amount').filter({ hasText: '+2' }).click();
	await page.getByTestId('reason').first().click();
	await expect(page.getByTestId('stars-note')).toHaveValue('Great job sharing!');
	await expectTappable(page.getByTestId('stars-submit'));
	await page.getByTestId('stars-submit').click();
	await expect(page.getByTestId('stars-balance')).toContainText('has 4 ⭐');
	await expect(page.getByTestId('toast')).toContainText('2 stars for');
	await expect(page.getByTestId('activity-row').first()).toContainText('Great job sharing!');
	await expect.poll(() => balance(page, s.memberId)).toBe(4);

	// Removing needs a note.
	await page.getByTestId('amount').filter({ hasText: '−1' }).click();
	await page.getByTestId('stars-submit').click();
	await expect(page.getByTestId('stars-error')).toContainText('note');
	expect(await balance(page, s.memberId)).toBe(4);
	await page.getByTestId('stars-note').fill('Left toys out');
	await page.getByTestId('stars-submit').click();
	await expect(page.getByTestId('stars-balance')).toContainText('has 3 ⭐');
	await expect(page.getByTestId('activity-row').first()).toContainText('Left toys out');
	await expect(page.getByTestId('activity-row').first()).toContainText('−1');
	await expect.poll(() => balance(page, s.memberId)).toBe(3);

	// A removal larger than the balance stops at zero.
	await page.getByTestId('amount').filter({ hasText: '−2' }).click();
	await expect(page.getByTestId('stars-submit')).toHaveText('Remove 2 ⭐');
	await page.getByTestId('stars-note').fill('Again');
	await page.getByTestId('stars-submit').click();
	await expect.poll(() => balance(page, s.memberId)).toBe(1);
	await page.getByTestId('amount').filter({ hasText: '−2' }).click();
	await expect(page.getByTestId('stars-clamp')).toContainText('only has 1');
	await page.getByTestId('stars-note').fill('Last one');
	await page.getByTestId('stars-submit').click();
	await expect.poll(() => balance(page, s.memberId)).toBe(0);
}

test('a grown-up gives and removes stars with notes', async ({ page }, info) => {
	await giveAndRemove(page, info.project.name);
});

test('the API refuses a removal without a note', async ({ page }, info) => {
	const s = await seedKid(page, `bonusapi ${info.project.name}`);
	const res = await page.request.post(`/api/members/${s.memberId}/bonus`, { data: { delta: -1 } });
	expect(res.status()).toBe(400);
});

test('the kid sees a bonus celebration with the note, a deduction stays quiet', async ({
	page
}, info) => {
	const notes = await stubAudio(page);
	const s = await seedKid(page, `bonuskid ${info.project.name}`);
	await openKid(page, s);
	await page.waitForTimeout(400);
	await expect(page.getByTestId('bonus-banner')).toHaveCount(0);

	await page.request.post(`/api/members/${s.memberId}/bonus`, {
		data: { delta: 2, note: 'Great job sharing!' }
	});
	await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
	const banner = page.getByTestId('bonus-banner');
	await expect(banner).toContainText('+2 stars');
	await expect(banner).toContainText('Great job sharing!');
	await expect.poll(notes).toBeGreaterThan(0);
	await expect(banner).toHaveCount(0, { timeout: 7000 });

	const before = await notes();
	await page.request.post(`/api/members/${s.memberId}/bonus`, {
		data: { delta: -1, note: 'Oops' }
	});
	await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
	await page.waitForTimeout(1200);
	await expect(page.getByTestId('bonus-banner')).toHaveCount(0);
	expect(await notes()).toBe(before);
});
