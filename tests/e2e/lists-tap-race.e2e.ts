import { expect, test, type Page } from '@playwright/test';
import { ensureHousehold, signInAsAdult } from './adult';
import { gotoHydrated, reloadHydrated } from './hydrated';

// LST-2: a tap on an item right after it was added must not be lost, even when it lands after the
// add answered but before the list re-read finished (the row still wears its temporary id).

async function openList(page: Page, name: string) {
	await gotoHydrated(page, '/lists');
	const tab = page.getByTestId('list-tab').filter({ hasText: name });
	await tab.click();
	await expect(tab).toHaveAttribute('aria-selected', 'true');
}

test('lists: a check tapped after the add answered, before the re-read lands, is kept @J6.1', async ({
	page
}, info) => {
	test.setTimeout(60_000);
	ensureHousehold();
	await page.setViewportSize({ width: 390, height: 844 });
	const tag = `race${Date.now().toString(36)}${info.workerIndex}${info.repeatEachIndex}`;
	await signInAsAdult(page, `e2e-lists-race-${info.project.name}`);
	let listId: string | null = null;
	try {
		const made = await page.request.post('/api/lists', { data: { title: tag } });
		expect(made.status()).toBe(201);
		listId = ((await made.json()) as { id: string }).id;
		await openList(page, tag);

		// Hold the re-read that follows the add, so the row keeps its temporary id meanwhile.
		let hold = true;
		let open!: () => void;
		const gate = new Promise<void>((r) => (open = r));
		let heldReads = 0;
		await page.route(/\/api\/lists$/, async (route) => {
			if (!hold || route.request().method() !== 'GET') return route.fallback();
			heldReads++;
			await gate;
			return route.fallback();
		});

		const row = page.getByTestId('list-item').filter({ hasText: tag });
		await page.getByTestId('item-input').fill(tag);
		const added = page.waitForResponse(
			(r) => r.url().includes(`/api/lists/${listId}/items`) && r.request().method() === 'POST'
		);
		await page.getByTestId('item-add').click();
		expect((await added).ok()).toBe(true);
		await expect.poll(() => heldReads).toBeGreaterThan(0);

		const saved = page.waitForResponse(
			(r) => r.url().includes('/api/list-items/') && r.request().method() === 'POST'
		);
		await row.getByTestId('item-check').click();
		hold = false;
		open();
		expect((await saved).ok()).toBe(true);
		await expect(row).toHaveAttribute('data-done', 'true');
		await reloadHydrated(page);
		await openList(page, tag);
		await expect(row).toHaveAttribute('data-done', 'true');
	} finally {
		if (listId) await page.request.delete(`/api/lists/${listId}`, { data: {}, maxRetries: 3 });
	}
});
