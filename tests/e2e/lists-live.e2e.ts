import { expect, test } from '@playwright/test';
import { ensureHousehold, signInAsAdult } from './adult';
import { gotoHydrated } from './hydrated';

// hub-7az.13: /api/events pushes list changes; the 60 s fallback poll must not be what delivers them.

test('an item added in one browser shows up in another within a second', async ({
	browser
}, info) => {
	ensureHousehold();
	const opts = { baseURL: info.project.use.baseURL, viewport: { width: 390, height: 844 } };
	const a = await browser.newContext(opts);
	const b = await browser.newContext(opts);
	const pa = await a.newPage();
	const pb = await b.newPage();
	const tag = `live${Date.now().toString(36)}${info.workerIndex}${info.repeatEachIndex}`;
	await signInAsAdult(pa, `e2e-live-${info.project.name}`);
	let listId: string | null = null;
	try {
		const res = await pa.request.post('/api/lists', { data: { title: tag } });
		listId = ((await res.json()) as { id: string }).id;
		// The stream's response headers arrive only after the server has subscribed this client.
		const streaming = pb.waitForResponse((r) => r.url().includes('/api/events'));
		for (const p of [pa, pb]) {
			await gotoHydrated(p, `/lists?list=${listId}`);
			await expect(p.getByTestId('list-tab').filter({ hasText: tag })).toHaveAttribute(
				'aria-selected',
				'true'
			);
		}
		await streaming;
		await pa.getByTestId('item-input').fill('milk');
		await pa.getByTestId('item-add').click();
		await expect(pa.getByTestId('list-item').filter({ hasText: 'milk' })).toHaveCount(1);
		await expect(pb.getByTestId('list-item').filter({ hasText: 'milk' })).toHaveCount(1, {
			timeout: 1_500
		});
		// Check it off in B; A follows without a duplicate or flicker.
		await pb.getByTestId('item-check').click();
		await expect(pa.getByTestId('list-item').filter({ hasText: 'milk' })).toHaveAttribute(
			'data-done',
			'true',
			{ timeout: 1_500 }
		);
		await expect(pb.getByTestId('list-item')).toHaveCount(1);
	} finally {
		if (listId) await pa.request.delete(`/api/lists/${listId}`, { data: {} });
		await a.close();
		await b.close();
	}
});
