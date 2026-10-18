import { expect, test, type Page } from '@playwright/test';
import { ensureHousehold, signInAsAdult } from './adult';
import { asWallDisplay } from './display';
import { expectTappable } from './tap';
import { gotoHydrated } from './hydrated';

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
	await gotoHydrated(page, '/lists');
	const tab = page.getByTestId('list-tab').filter({ hasText: name });
	await tab.click();
	await expect(tab).toHaveAttribute('aria-selected', 'true');
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
		await page.getByTestId('key-shift').click();
		await page.getByTestId('key-shift').click();
		await tapKeys(page, tag);
		await page.getByTestId('key-enter').click();
		await expect(row()).toHaveCount(1);
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

test('long-press an item to delete it, gone after reload', async ({ page, context }, info) => {
	ensureHousehold();
	await asWallDisplay(context);
	const tag = `del${Date.now().toString(36)}${info.workerIndex}${info.repeatEachIndex}`;
	const row = () => page.getByTestId('list-item').filter({ hasText: tag });
	await signInAsAdult(page, `e2e-lists-${info.project.name}`);
	let listId: string | null = null;
	try {
		listId = await makeList(page, tag);
		const added = await page.request.post(`/api/lists/${listId}/items`, { data: { text: tag } });
		expect(added.ok()).toBe(true);
		await openList(page, tag);
		await expect(row()).toHaveCount(1);
		await expect(page.getByTestId('item-delete')).toHaveCount(0);

		const box = (await row().getByTestId('item-check').boundingBox())!;
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		await page.waitForTimeout(800);
		await page.mouse.up();
		// The press must not have toggled the item.
		await expect(row()).toHaveAttribute('data-done', 'false');
		const del = row().getByTestId('item-delete');
		await expectTappable(del);

		// Tapping elsewhere dismisses it.
		await page.mouse.click(2, 2);
		await expect(del).toHaveCount(0);

		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		await page.waitForTimeout(800);
		await page.mouse.up();
		const deleted = page.waitForResponse(
			(r) => r.url().includes('/api/list-items/') && r.request().method() === 'DELETE'
		);
		await del.click();
		await expect(row()).toHaveCount(0);
		expect((await deleted).ok()).toBe(true);
		await openList(page, tag);
		await expect(row()).toHaveCount(0);
	} finally {
		await dropList(page, listId);
	}
});

test('create a list from the wall keyboard, keep it across reload, adult deletes it', async ({
	page,
	context
}, info) => {
	ensureHousehold();
	await asWallDisplay(context);
	const tag = `new${Date.now().toString(36)}${info.workerIndex}${info.repeatEachIndex}`;
	const tab = () => page.getByTestId('list-tab').filter({ hasText: tag });
	await signInAsAdult(page, `e2e-lists-${info.project.name}`);
	let created = false;
	try {
		await gotoHydrated(page, '/lists');
		await expectTappable(page.getByTestId('list-new'));
		await page.getByTestId('list-new').click();
		await page.getByTestId('key-shift').click();
		await page.getByTestId('key-shift').click();
		await tapKeys(page, tag);
		const posted = page.waitForResponse(
			(r) => r.url().endsWith('/api/lists') && r.request().method() === 'POST'
		);
		await page.getByTestId('key-enter').click();
		created = true;
		expect((await posted).status()).toBe(201);
		await expect(tab()).toHaveAttribute('aria-selected', 'true');
		await expect(page).toHaveURL(/list=[0-9a-f-]{36}/);

		await page.reload();
		await expect(tab()).toHaveAttribute('aria-selected', 'true');

		await expectTappable(page.getByTestId('list-delete'));
		await page.getByTestId('list-delete').click();
		await page.getByTestId('list-confirm-cancel').click();
		await expect(tab()).toHaveCount(1);
		await page.getByTestId('list-delete').click();
		const deleted = page.waitForResponse(
			(r) => r.url().includes('/api/lists/') && r.request().method() === 'DELETE'
		);
		await page.getByTestId('list-confirm-delete').click();
		expect((await deleted).ok()).toBe(true);
		await expect(tab()).toHaveCount(0);
		await page.reload();
		await expect(tab()).toHaveCount(0);
		created = false;
	} finally {
		if (created) {
			const all = (await (await page.request.get('/api/lists')).json()) as {
				id: string;
				title: string;
			}[];
			for (const l of all.filter((x) => x.title === tag)) await dropList(page, l.id);
		}
	}
});
