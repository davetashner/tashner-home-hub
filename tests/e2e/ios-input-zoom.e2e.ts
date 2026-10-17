import { expect, test, type Page } from '@playwright/test';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { signInAsAdult } from './adult';

// DEV-5: iOS Safari zooms the page when a focused field computes below 16px.
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

/** Visible text-like fields (not radios, checkboxes or hidden inputs) under 16px. */
async function smallFields(page: Page): Promise<string[]> {
	return page.evaluate(() =>
		[...document.querySelectorAll('input, select, textarea')]
			.filter((el) => {
				const type = (el as HTMLInputElement).type;
				if (['radio', 'checkbox', 'hidden', 'range', 'file', 'button', 'submit'].includes(type))
					return false;
				const box = el.getBoundingClientRect();
				return box.width > 0 && box.height > 0;
			})
			.map((el) => ({
				id: `${el.tagName}[${(el as HTMLInputElement).type ?? ''}]`,
				size: parseFloat(getComputedStyle(el).fontSize)
			}))
			.filter((f) => f.size < 16)
			.map((f) => `${f.id}: ${f.size}px`)
	);
}

const routes = discover();

for (const route of routes) {
	test(`ios: fields on ${route} are at least 16px at 390px`, async ({ page }, info) => {
		await signInAsAdult(page, `e2e-zoom-${info.project.name}`);
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto(route);
		await page.waitForLoadState('networkidle');
		expect(await smallFields(page)).toEqual([]);
	});
}

for (const f of [
	{ path: '/settings/chores', open: 'Add Star Job' },
	{ path: '/settings/rewards', open: 'Add reward' },
	{ path: '/settings/family', open: 'Add person' }
]) {
	test(`ios: the ${f.open} form fields are at least 16px`, async ({ page }, info) => {
		await signInAsAdult(page, `e2e-zoom-form-${info.project.name}`);
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto(f.path);
		// A tap before the page hydrates is lost, so retry the click until the form opens.
		await expect(async () => {
			await page.getByRole('button', { name: f.open }).click();
			await expect(page.locator('form').first()).toBeVisible({ timeout: 1000 });
		}).toPass();
		expect(await smallFields(page)).toEqual([]);
	});
}

test('ios: a bare input with no classes is at least 16px at 390px', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/unlock');
	const size = await page.evaluate(() => {
		const input = document.createElement('input');
		document.body.append(input);
		const px = parseFloat(getComputedStyle(input).fontSize);
		input.remove();
		return px;
	});
	expect(size).toBeGreaterThanOrEqual(16);
});
