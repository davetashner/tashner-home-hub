import { expect, test } from '@playwright/test';
import { signInAsAdult } from './adult';
import { trackMember } from './cleanup';
import { choreCard, stubAudio } from './kid';
import { gotoHydrated } from './hydrated';

test('earning the first badge celebrates once and fills the sticker book', async ({
	page
}, info) => {
	await stubAudio(page);
	await signInAsAdult(page, `adult-badge-${info.project.name.replace(/\W/g, '')}`);
	const member = await (
		await page.request.post('/api/members', {
			data: { name: `Stickie ${Date.now() % 1e9}`, role: 'child', color: 'member-4', avatar: '🦊' }
		})
	).json();
	trackMember(member.id);
	for (const title of ['Water plants', 'Sort socks']) {
		await page.request.post('/api/chores', {
			data: {
				title,
				icon: '🌱',
				stars: 2,
				memberIds: [member.id],
				schedule: { type: 'daily' },
				requiresApproval: false
			}
		});
	}

	// A fresh kid starts with an empty, uncelebrated book.
	await gotoHydrated(page, `/chores?member=${member.id}`);
	await expect(page.getByTestId('star-jar')).toBeVisible();
	await expect(page.getByTestId('badge-banner')).toHaveCount(0);
	await page.getByTestId('open-stickers').click();
	await expect(page.getByTestId('sticker-count')).toHaveText('0 of 10 stickers');
	await page.getByTestId('stickers-close').click();

	await choreCard(page, 'Water plants').getByTestId('did-it').click();
	await expect(page.getByTestId('badge-banner')).toContainText('First Star Job');
	await expect(page.getByTestId('badge-banner')).toHaveCount(0, { timeout: 8000 });

	await page.getByTestId('open-stickers').click();
	await expect(page.getByTestId('sticker-count')).toHaveText('1 of 10 stickers');
	const earned = page.locator('[data-testid="sticker"][data-earned="true"]');
	await expect(earned).toHaveCount(1);
	await expect(earned).toContainText('First Star Job');
	await expect(page.locator('[data-testid="sticker"][data-earned="false"]')).toHaveCount(9);
	await expect(page.getByTestId('sticker-book')).toContainText('Earn 10 stars in all');
	await page.getByTestId('stickers-close').click();

	// The same badge is not celebrated again after a reload.
	await gotoHydrated(page, `/chores?member=${member.id}`);
	await expect(page.getByTestId('star-jar')).toBeVisible();
	await page.waitForTimeout(800);
	await expect(page.getByTestId('badge-banner')).toHaveCount(0);
});
