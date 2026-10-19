import { expect, test } from '@playwright/test';
import { signInAsAdult } from './adult';
import { gotoHydrated } from './hydrated';
import { holdLock } from './file-lock';

const START = '2031-06-01';
const BACK = '2031-06-20';

test('vacation: dates saved in quick succession land in the order they were set @J13.2', async ({
	page
}, info) => {
	test.setTimeout(60_000);
	const release = await holdLock('vacation');
	try {
		await signInAsAdult(page, `adult-vacation-order-${info.project.name.replace(/\W/g, '')}`);
		// Hold the first save back so, without ordering, the later ones would reach the server first.
		let open!: () => void;
		const gate = new Promise<void>((r) => (open = r));
		let first = true;
		await page.route('**/api/settings/vacation', async (route) => {
			if (route.request().method() !== 'PUT') return route.fallback();
			if (first) {
				first = false;
				await gate;
			}
			return route.fallback();
		});
		await gotoHydrated(page, '/settings/vacation');
		await page.getByTestId('vacation-switch').click();
		await page.getByTestId('vacation-start').fill(START);
		await page.getByTestId('vacation-back').fill(BACK);
		// Unordered, the later saves are already on the wire; ordered, they wait behind the first.
		await page.waitForTimeout(500);
		open();
		await expect
			.poll(async () => (await (await page.request.get('/api/settings/vacation')).json()).vacation)
			.toEqual({ start: START, back: BACK });
	} finally {
		await page.request.delete('/api/settings/vacation', { data: {} });
		release();
	}
});
