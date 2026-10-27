import { expect, test } from '@playwright/test';
import { signInAsAdult } from './adult';
import { px } from './tap';
import { gotoHydrated } from './hydrated';

// hub-kko.1: grown-ups define the reading and practice activities kids earn stars for.
test('adults add, edit and turn off a practice activity @J9.11', async ({ page }, info) => {
	await signInAsAdult(page, `e2e-practice-${info.project.name}`);
	const tag = info.project.name;
	const name = `Piano ${tag}`;
	try {
		await gotoHydrated(page, '/settings/practice');
		const row = (n: string) => page.getByTestId('activity-row').filter({ hasText: n });
		await expect(row('Reading')).toContainText('1 star per 15 min, up to 4 a day. All kids');
		await expect(row('Practice')).toBeVisible();

		await page.getByTestId('add-activity').click();
		await page.getByTestId('activity-name').fill(name);
		await page.getByTestId('activity-minutes').fill('10');
		await page.getByTestId('activity-stars').fill('2');
		await page.getByTestId('activity-cap').fill('6');
		await page.getByRole('button', { name: 'Music', exact: true }).click();
		await page.getByTestId('activity-save').click();
		await expect(row(name)).toContainText('2 stars per 10 min, up to 6 a day. All kids');

		await row(name)
			.getByRole('button', { name: `Edit ${name}` })
			.click();
		await page.getByTestId('activity-cap').fill('3');
		await page.getByTestId('activity-save').click();
		await expect(row(name)).toContainText('up to 3 a day');
		const box = await row(name)
			.getByRole('button', { name: `Edit ${name}` })
			.boundingBox();
		expect(px(box!.height)).toBeGreaterThanOrEqual(60);

		await row(name)
			.getByRole('button', { name: `Turn off ${name}` })
			.click();
		await expect(row(name)).toContainText('Off');
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		);
		expect(overflow).toBeLessThanOrEqual(0);
	} finally {
		// Activities are never deleted; leave the test one switched off.
		const list = (await (await page.request.get('/api/practice-activities')).json()) as {
			id: string;
			name: string;
		}[];
		for (const a of list)
			if (a.name.endsWith(tag))
				await page.request.patch(`/api/practice-activities/${a.id}`, { data: { active: false } });
	}
});
