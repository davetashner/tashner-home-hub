import type { BrowserContext } from '@playwright/test';

const HOST = process.env.E2E_HOST ?? '127.0.0.1';

/** Makes every page in this context a wall display (DEV-1), as the Pi kiosk is. */
export async function asWallDisplay(context: BrowserContext): Promise<void> {
	await context.addCookies([{ name: 'hub_display', value: 'wall', domain: HOST, path: '/' }]);
}
