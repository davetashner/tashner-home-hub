import { expect, type Page, type Response } from '@playwright/test';

/**
 * Navigates, then waits until SvelteKit has hydrated the page. The root layout sets
 * `data-hydrated` on <html> from onMount, which runs after every child component has mounted and
 * attached its handlers. A tap or keystroke before that point acts on bare server-rendered markup
 * and is lost (or re-applied over by hydration), so specs go through this instead of retrying.
 */
export async function gotoHydrated(
	page: Page,
	url: string,
	options?: Parameters<Page['goto']>[1]
): Promise<Response | null> {
	const response = await page.goto(url, options);
	await expect(page.locator('html[data-hydrated]')).toBeAttached();
	return response;
}

/** `page.reload()` that waits for hydration again; the fresh document has no marker until then. */
export async function reloadHydrated(
	page: Page,
	options?: Parameters<Page['reload']>[0]
): Promise<Response | null> {
	const response = await page.reload(options);
	await expect(page.locator('html[data-hydrated]')).toBeAttached();
	return response;
}
