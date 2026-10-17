import type { BrowserContext } from '@playwright/test';

const HOST = process.env.E2E_HOST ?? '127.0.0.1';

/** Makes every page in this context a wall display (DEV-1), as the Pi kiosk is. */
export async function asWallDisplay(context: BrowserContext): Promise<void> {
	await context.addCookies([{ name: 'hub_display', value: 'wall', domain: HOST, path: '/' }]);
	// The wake guard swallows taps while the real schedule says "off", so tests pin the display
	// on whatever the time of day. Pages that route this URL themselves take precedence.
	await context.route('**/api/display/power', (route) =>
		route.fulfill({ json: { power: 'on', reason: 'schedule', mode: 'normal' } })
	);
}
