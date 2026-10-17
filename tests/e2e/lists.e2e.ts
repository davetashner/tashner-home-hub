import { expect, test, type Page } from '@playwright/test';
import { ensureHousehold, signInAsAdult } from './adult';
import { asWallDisplay } from './display';
import { expectTappable } from './tap';

// LST-1 / LST-2: shared lists. The wall types with its own on-screen keyboard; phones use the input.

/** Each test works in its own list: "clear checked" in one project must not touch another's items. */
async function makeList(page: Page, name: string): Promise<string> {
	const res = await page.request.post('/api/lists', { data: { title: name } });
	expect(res.status()).toBe(201);
	return ((await res.json()) as { id: string }).id;
}

async function dropList(page: Page, id: string | null) {
	if (id === null) return;
	const res = await page.request.delete(`/api/lists/${id}`, { data: {} });
	expect(res.ok()).toBe(true);
}

async function openList(page: Page, name: string) {
	await page.goto('/lists');
	await expect(async () => {
		await page.getByTestId('list-tab').filter({ hasText: name }).click({ timeout: 1000 });
		await expect(page.getByTestId('list-tab').filter({ hasText: name })).toHaveAttribute(
			'aria-selected',
			'true',
			{ timeout: 1000 }
		);
	}).toPass();
}

const tapKeys = async (page: Page, text: string) => {
	for (const ch of text.toLowerCase())
		await page.getByTestId(ch === ' ' ? 'key-space' : `key-${ch}`).click();
};

test('wall keyboard: add, check off, reload and clear checked', async ({ page, context }, info) => {
	ensureHousehold();
	await asWallDisplay(context);
	const tag = `e2e${Date.now().toString(36)}${info.workerIndex}${info.repeatEachIndex}`;
	const row = () => page.getByTestId('list-item').filter({ hasText: tag });
	await signInAsAdult(page, `e2e-lists-${info.project.name}`);
	let listId: string | null = null;
	try {
		listId = await makeList(page, tag);
		await openList(page, tag);
		// Only digits and lowercase letters are keys; the tag is already both.
		await expect(async () => {
			await page.getByTestId('key-shift').click();
			await page.getByTestId('key-shift').click();
			await tapKeys(page, tag);
			await page.getByTestId('key-enter').click();
			await expect(row()).toHaveCount(1, { timeout: 1500 });
		}).toPass();
		await expectTappable(page.getByTestId('key-q'));
		await expectTappable(page.getByTestId('key-enter'));
		await expectTappable(row().getByTestId('item-check'));

		const saved = page.waitForResponse(
			(r) => r.url().includes('/api/list-items/') && r.request().method() === 'POST'
		);
		await row().getByTestId('item-check').click();
		expect((await saved).ok()).toBe(true);
		await expect(row()).toHaveAttribute('data-done', 'true');
		await openList(page, tag);
		await expect(row()).toHaveAttribute('data-done', 'true');

		await page.getByTestId('clear-checked').click();
		await expect(row()).toHaveCount(0);
		await openList(page, tag);
		await expect(row()).toHaveCount(0);
	} finally {
		await dropList(page, listId);
	}
});

test('phone: add through the input', async ({ browser }, info) => {
	ensureHousehold();
	const context = await browser.newContext({
		baseURL: info.project.use.baseURL,
		viewport: { width: 390, height: 844 },
		hasTouch: true
	});
	const page = await context.newPage();
	const tag = `ph${Date.now().toString(36)}${info.workerIndex}${info.repeatEachIndex}`;
	await signInAsAdult(page, `e2e-lists-${info.project.name}`);
	let listId: string | null = null;
	try {
		listId = await makeList(page, tag);
		await openList(page, tag);
		await expect(page.getByTestId('keyboard')).toHaveCount(0);
		const input = page.getByTestId('item-input');
		await input.fill(tag);
		const size = await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
		expect(size).toBeGreaterThanOrEqual(16);
		await page.getByTestId('item-add').click();
		await expect(page.getByTestId('list-item').filter({ hasText: tag })).toHaveCount(1);
	} finally {
		await dropList(page, listId);
		await context.close();
	}
});
