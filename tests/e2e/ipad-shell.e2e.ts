import { expect, test } from '@playwright/test';
import { ensureHousehold, signInAsAdult } from './adult';
import { expectTappable } from './tap';

// DEV-4/UI-8: on an iPad (or a Split View pane) the shell is a tablet tier: a one-row header and a
// slim rail or bar, so the page gets the screen, not the chrome.
test.beforeAll(ensureHousehold);

const viewports = [
	{ name: 'iPad portrait 834x1194', width: 834, height: 1194 },
	{ name: 'iPad portrait 820x1180', width: 820, height: 1180 },
	{ name: 'iPad Pro portrait 1024x1366', width: 1024, height: 1366 },
	{ name: 'iPad landscape 1194x834', width: 1194, height: 834 },
	{ name: 'iPad landscape 1180x820', width: 1180, height: 820 },
	{ name: 'iPad Pro landscape 1366x1024', width: 1366, height: 1024 },
	{ name: 'Split View 507x834', width: 507, height: 834 },
	{ name: 'Split View 678x834', width: 678, height: 834 }
];
const routes = ['/', '/chores', '/calendar', '/settings'];

for (const vp of viewports) {
	test.describe(vp.name, () => {
		test.beforeEach(async ({ page }, info) => {
			await page.setViewportSize({ width: vp.width, height: vp.height });
			await signInAsAdult(page, `e2e-ipad-shell-${info.workerIndex}`);
		});

		for (const route of routes) {
			test(`${route}: compact shell leaves the page the screen`, async ({ page }) => {
				await page.goto(route);
				await page.waitForLoadState('networkidle');

				const shell = page.locator('nav[aria-label="Main"]').locator('xpath=..');
				const header = shell.locator(':scope > header');
				const nav = shell.locator(':scope > nav');
				const main = shell.locator(':scope > main');

				// One row: every header control shares a vertical centre and the bar stays slim.
				const headerBox = (await header.boundingBox())!;
				expect(headerBox.height).toBeLessThanOrEqual(120);
				const controls = header.locator('a, button');
				const count = await controls.count();
				expect(count).toBeGreaterThanOrEqual(3);
				const centres: number[] = [];
				for (let i = 0; i < count; i++) {
					const control = controls.nth(i);
					if (!(await control.isVisible())) continue;
					await expectTappable(control);
					const box = (await control.boundingBox())!;
					centres.push(box.y + box.height / 2);
				}
				expect(Math.max(...centres) - Math.min(...centres)).toBeLessThanOrEqual(8);

				// Nav tap targets.
				const items = nav.locator('a');
				for (let i = 0; i < (await items.count()); i++) await expectTappable(items.nth(i));

				// The rail or bar is a slim strip.
				const navBox = (await nav.boundingBox())!;
				if (vp.width > vp.height) {
					expect(navBox.width / vp.width).toBeLessThanOrEqual(0.25);
				} else {
					expect(navBox.height / vp.height).toBeLessThanOrEqual(0.15);
				}

				// No sideways scroll, and the page gets most of the screen.
				const { scrollWidth, innerWidth } = await page.evaluate(() => ({
					scrollWidth: document.documentElement.scrollWidth,
					innerWidth: window.innerWidth
				}));
				expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
				const mainBox = (await main.boundingBox())!;
				expect((mainBox.width * mainBox.height) / (vp.width * vp.height)).toBeGreaterThanOrEqual(
					0.65
				);
			});
		}
	});
}
