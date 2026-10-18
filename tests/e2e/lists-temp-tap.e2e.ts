import { expect, test } from '@playwright/test';
import { ensureHousehold, signInAsAdult } from './adult';
import { gotoHydrated } from './hydrated';

// hub-8mg: a tap on an item whose add is still in flight must not be lost to a temp-id 404.

test('checking an item before its add returns still checks it on the server @J6.4', async ({
	browser
}, info) => {
	ensureHousehold();
	const ctx = await browser.newContext({
		baseURL: info.project.use.baseURL,
		viewport: { width: 390, height: 844 }
	});
	const page = await ctx.newPage();
	const tag = `tmp${Date.now().toString(36)}${info.workerIndex}${info.repeatEachIndex}`;
	await signInAsAdult(page, `e2e-temp-${info.project.name}`);
	let listId: string | null = null;
	try {
		const res = await page.request.post('/api/lists', { data: { title: tag } });
		listId = ((await res.json()) as { id: string }).id;
		await gotoHydrated(page, `/lists?list=${listId}`);
		let release = () => {};
		const gate = new Promise<void>((r) => (release = r));
		await page.route(`**/api/lists/${listId}/items`, async (route) => {
			await gate;
			await route.continue();
		});
		await page.getByTestId('item-input').fill('eggs');
		await page.getByTestId('item-add').click();
		const row = page.getByTestId('list-item').filter({ hasText: 'eggs' });
		await expect(row).toHaveCount(1);
		await page.getByTestId('item-check').click();
		await expect(row).toHaveAttribute('data-done', 'true');
		release();
		await expect
			.poll(async () => {
				const all = (await (await page.request.get('/api/lists')).json()) as {
					id: string;
					items: { text: string; done: boolean }[];
				}[];
				return all.find((l) => l.id === listId)?.items.map((i) => i.done);
			})
			.toEqual([true]);
		await expect(row).toHaveCount(1);
		await expect(row).toHaveAttribute('data-done', 'true');
	} finally {
		if (listId) await page.request.delete(`/api/lists/${listId}`, { data: {} });
		await ctx.close();
	}
});
