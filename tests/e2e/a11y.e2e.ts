import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { readdirSync } from 'node:fs';
import path from 'node:path';

// ADR 0002 Tier 2: every screen must have no serious/critical axe violations (incl. WCAG AA contrast).
const routesDir = path.resolve('src/routes');

/** URL paths for every directory under src/routes that has a +page.svelte. */
function discoverRoutes(dir = routesDir, urlPath = ''): string[] {
	const entries = readdirSync(dir, { withFileTypes: true });
	const routes = entries.some((e) => e.isFile() && e.name === '+page.svelte')
		? [urlPath || '/']
		: [];
	for (const e of entries) {
		if (!e.isDirectory()) continue;
		// Dynamic segments ([id], [...rest]) have no canonical URL to visit; skip them.
		if (/^\[.*\]$/.test(e.name)) continue;
		const isGroup = /^\(.*\)$/.test(e.name);
		routes.push(
			...discoverRoutes(path.join(dir, e.name), isGroup ? urlPath : `${urlPath}/${e.name}`)
		);
	}
	return routes;
}

const routes = discoverRoutes();

test('route discovery finds the home page', () => {
	expect(routes).toContain('/');
});

for (const route of routes) {
	test(`a11y: ${route} has no serious or critical violations`, async ({ page }) => {
		await page.goto(route);
		await page.waitForLoadState('networkidle');
		const { violations } = await new AxeBuilder({ page })
			.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
			.analyze();
		const blocking = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
		expect(
			blocking.map((v) => `${v.impact} ${v.id}: ${v.help} (${v.nodes.length} nodes)`),
			`axe violations on ${route}`
		).toEqual([]);
	});
}
