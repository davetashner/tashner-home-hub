import { expect, test } from '@playwright/test';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { signInAsAdult } from './adult';

// ADM-1: every admin page must be usable from a phone (390x844). Pages are discovered from the
// settings subtree so new ones are covered automatically.
const settingsDir = path.resolve('src/routes/(app)/settings');

function discover(dir = settingsDir, urlPath = '/settings'): string[] {
	const entries = readdirSync(dir, { withFileTypes: true });
	const routes = entries.some((e) => e.isFile() && e.name === '+page.svelte') ? [urlPath] : [];
	for (const e of entries) {
		if (!e.isDirectory() || /^\[.*\]$/.test(e.name)) continue;
		routes.push(...discover(path.join(dir, e.name), `${urlPath}/${e.name}`));
	}
	return routes;
}

const routes = discover();

test('settings discovery finds the admin pages', () => {
	expect(routes).toContain('/settings/chores');
	expect(routes).toContain('/settings/sleep-schedule');
});

for (const route of routes) {
	test(`phone: ${route} fits 390px with short headings`, async ({ page }, info) => {
		await signInAsAdult(page, `e2e-phone-${info.project.name}`);
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto(route);
		await page.waitForLoadState('networkidle');

		const main = page.locator('main');
		const overflowing = await main.evaluate((el) => {
			const edge = el.getBoundingClientRect().right;
			return [...el.querySelectorAll('*')]
				.filter((c) => c.getBoundingClientRect().right > edge + 1)
				.slice(0, 5)
				.map((c) => `${c.tagName}.${c.className}: ${(c.textContent ?? '').slice(0, 20)}`);
		});
		expect(overflowing, 'elements past the right edge').toEqual([]);
		const overflow = await main.evaluate((el) => el.scrollWidth - el.clientWidth);
		expect(overflow, 'no sideways scroll').toBeLessThanOrEqual(0);

		const tall = await page.locator('main h1, main h2, main h3').evaluateAll((els) =>
			els
				.map((el) => {
					const lineHeight = parseFloat(getComputedStyle(el).lineHeight);
					return {
						text: el.textContent?.trim(),
						lines: el.getBoundingClientRect().height / lineHeight
					};
				})
				.filter((h) => h.lines > 3.5)
		);
		expect(tall, 'headings wrap onto more than 3 lines').toEqual([]);
	});
}

const forms = [
	{ name: 'chore', path: '/settings/chores', open: 'Add chore', form: 'chore-form' },
	{ name: 'reward', path: '/settings/rewards', open: 'Add reward', form: 'reward-form' },
	{ name: 'family member', path: '/settings/family', open: 'Add person', form: 'member-form' }
];

for (const f of forms) {
	test(`phone: the ${f.name} form fits the screen width`, async ({ page }, info) => {
		await signInAsAdult(page, `e2e-phone-form-${info.project.name}`);
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto(f.path);
		await page.getByRole('button', { name: f.open }).click();
		const form = page.locator(`[data-testid="${f.form}"], form`).first();
		await expect(form).toBeVisible();
		const offenders = await form.evaluate((el) =>
			[...el.querySelectorAll('*')]
				.filter((c) => c.getBoundingClientRect().right > window.innerWidth + 1)
				.map((c) => c.tagName + ':' + (c.textContent ?? '').slice(0, 20))
		);
		expect(offenders, 'controls past the right edge').toEqual([]);
	});
}
