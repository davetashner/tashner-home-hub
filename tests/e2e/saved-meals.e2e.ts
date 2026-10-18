import { expect, test } from '@playwright/test';
import { signInAsAdult } from './adult';
import { gotoHydrated } from './hydrated';

// MEAL-2. Names carry a per-project tag so parallel projects sharing one database stay apart.
const JSON_HEADERS = { 'content-type': 'application/json' };

test('save a meal, add its ingredients to Grocery twice, plan a day from it @J7.3', async ({
	page
}, info) => {
	await signInAsAdult(page, `e2e-saved-meals-${info.project.name}`);
	const tag = `${info.project.name}-${Date.now().toString(36)}`;
	const name = `Chili ${tag}`;
	const tomato = `tomatoes ${tag}`;
	const beans = `beans ${tag}`;
	let mealId = '';
	try {
		await gotoHydrated(page, '/meals');
		await page.getByTestId('saved-open').click();
		await page.getByTestId('saved-new').click();
		await page.getByTestId('saved-emoji').fill('🌶️');
		await page.getByTestId('saved-name').fill(name);
		await page.getByTestId('saved-ingredients').fill(`${tomato}\n${beans}`);
		await page.getByTestId('saved-save').click();
		const row = page.locator(`[data-testid="saved-row"][data-name="${name}"]`);
		await expect(row).toBeVisible();
		await expect(row).toContainText('2 ingredients');

		const meals = await (await page.request.get('/api/saved-meals')).json();
		mealId = meals.find((m: { name: string }) => m.name === name).id;

		// An existing open item is skipped, case-insensitively.
		const lists = await (await page.request.get('/api/lists')).json();
		const grocery = lists.find((l: { title: string }) => l.title === 'Grocery');
		await page.request.post(`/api/lists/${grocery.id}/items`, {
			headers: JSON_HEADERS,
			data: { text: tomato.toUpperCase() }
		});

		await row.getByTestId('saved-grocery').click();
		await expect(page.getByTestId('meals-toast')).toHaveText('Added 1, 1 already on the list');
		await row.getByTestId('saved-grocery').click();
		await expect(page.getByTestId('meals-toast')).toHaveText('All 2 already on the list');

		// Plan a day from it with one tap on its chip.
		await page.getByTestId('saved-close').click();
		await page.getByTestId('meal-cell').first().click();
		await page.getByTestId('meal-saved-chip').filter({ hasText: name }).click();
		await expect(page.getByTestId('meals-grid')).toContainText(name);
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		);
		expect(overflow).toBeLessThanOrEqual(0);
	} finally {
		if (mealId)
			await page.request.delete(`/api/saved-meals/${mealId}`, { headers: JSON_HEADERS, data: {} });
	}
});

test('saved meal writes need an adult; reading and adding to Grocery do not @J7.6', async ({
	page,
	request
}, info) => {
	await signInAsAdult(page, `e2e-saved-meals-api-${info.project.name}`);
	const made = await page.request.post('/api/saved-meals', {
		headers: JSON_HEADERS,
		data: { name: `Rice ${info.project.name}`, ingredients: ['rice'] }
	});
	expect(made.status()).toBe(201);
	const id = (await made.json()).id as string;
	try {
		expect((await request.get('/api/saved-meals')).ok()).toBe(true);
		expect(
			(
				await request.post('/api/saved-meals', { headers: JSON_HEADERS, data: { name: 'x' } })
			).status()
		).toBe(401);
		expect(
			(
				await request.patch(`/api/saved-meals/${id}`, {
					headers: JSON_HEADERS,
					data: { name: 'y' }
				})
			).status()
		).toBe(401);
		expect(
			(await request.delete(`/api/saved-meals/${id}`, { headers: JSON_HEADERS, data: {} })).status()
		).toBe(401);
	} finally {
		await page.request.delete(`/api/saved-meals/${id}`, { headers: JSON_HEADERS, data: {} });
	}
});
