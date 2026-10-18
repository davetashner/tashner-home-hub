import { expect, test } from '@playwright/test';
import { signInAsAdult } from './adult';
import { px } from './tap';
import { gotoHydrated } from './hydrated';

// CD-1: countdowns on the home screen. Each project freezes the clock in its own far-off year so
// parallel projects sharing one database never crowd each other out of the (capped) home list.
const PROJECTS = [
	'wall-landscape-1440p',
	'wall-portrait-1440p',
	'iphone-webkit',
	'ipad-portrait-webkit',
	'ipad-landscape-webkit'
];

const addDays = (date: string, n: number) => {
	const d = new Date(`${date}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + n);
	return d.toISOString().slice(0, 10);
};

test('adults add, edit and delete countdowns; home counts down in days @J0.4', async ({
	page
}, info) => {
	const k = Math.max(0, PROJECTS.indexOf(info.project.name));
	const today = `${2041 + k}-06-10`;
	await page.clock.setFixedTime(new Date(`${today}T12:00:00`));
	await signInAsAdult(page, `e2e-countdowns-${info.project.name}`);
	const tag = info.project.name;

	const created: string[] = [];
	try {
		await gotoHydrated(page, '/settings/countdowns');
		const add = async (name: string, date: string, icon: string) => {
			await page.getByTestId('add-countdown').click();
			await expect(page.getByTestId('countdown-form')).toBeVisible();
			await page.getByTestId('countdown-icon').fill(icon);
			await page.getByTestId('countdown-title').fill(name);
			await page.getByTestId('countdown-date').fill(date);
			await page.getByTestId('countdown-save').click();
			await expect(page.getByTestId('countdown-row').filter({ hasText: name })).toBeVisible();
		};
		await add(`Birthday ${tag}`, today, '🎂');
		await add(`Trip ${tag}`, addDays(today, 12), '🏖️');
		await add(`Party ${tag}`, addDays(today, 1), '🎉');
		await add(`Old news ${tag}`, addDays(today, -3), '📰');

		// Edit: push the trip out by a day.
		const trip = page.getByTestId('countdown-row').filter({ hasText: `Trip ${tag}` });
		await trip.getByRole('button', { name: `Edit Trip ${tag}` }).click();
		await page.getByTestId('countdown-date').fill(addDays(today, 13));
		await page.getByTestId('countdown-save').click();
		await expect(trip).toContainText(addDays(today, 13));
		const box = await trip.getByRole('button', { name: `Edit Trip ${tag}` }).boundingBox();
		expect(px(box!.height)).toBeGreaterThanOrEqual(60);

		await gotoHydrated(page, '/');
		const cards = page.getByTestId('home-countdown');
		await expect(cards).toHaveCount(3);
		await expect(cards.nth(0)).toContainText('Today');
		await expect(cards.nth(0)).toContainText(`Birthday ${tag}`);
		await expect(cards.nth(1)).toContainText('Tomorrow');
		await expect(cards.nth(2)).toContainText('13 days');
		await expect(page.getByTestId('home-countdowns')).not.toContainText('Old news');

		// Fits the viewport in both orientations: no sideways scroll.
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		);
		expect(overflow).toBeLessThanOrEqual(0);

		// Tomorrow: Birthday has expired, Party is today.
		await page.clock.setFixedTime(new Date(`${addDays(today, 1)}T12:00:00`));
		await gotoHydrated(page, '/');
		await expect(cards.nth(0)).toContainText('Today');
		await expect(cards.nth(0)).toContainText(`Party ${tag}`);
		await expect(page.getByTestId('home-countdowns')).not.toContainText(`Birthday ${tag}`);

		// Delete.
		await gotoHydrated(page, '/settings/countdowns');
		await page.getByRole('button', { name: `Delete Trip ${tag}` }).click();
		await expect(page.getByTestId('countdown-row').filter({ hasText: `Trip ${tag}` })).toHaveCount(
			0
		);
	} finally {
		const list = await (await page.request.get('/api/countdowns')).json();
		for (const c of list as { id: string; title: string }[])
			if (c.title.endsWith(tag)) created.push(c.id);
		for (const id of created) await page.request.delete(`/api/countdowns/${id}`, { data: {} });
	}
});
