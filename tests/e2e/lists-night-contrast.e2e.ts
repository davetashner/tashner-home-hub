import { expect, test, type Locator } from '@playwright/test';
import { ensureHousehold, signInAsAdult } from './adult';
import { asWallDisplay } from './display';
import { gotoHydrated } from './hydrated';

// hub-1b7: on the wall at night the selected chip/tab and the unselected ones must stay readable
// against the night wave background (UI-3, UI-5). Colours are read from the rendered page.

type Rgb = [number, number, number];

/** Resolves any CSS colour (oklch included) to sRGB through a canvas, in the page. */
async function rgbOf(
	el: Locator,
	prop: 'color' | 'backgroundColor' | 'borderTopColor'
): Promise<Rgb> {
	return el.evaluate((node, p) => {
		const c = document.createElement('canvas');
		c.width = c.height = 1;
		const ctx = c.getContext('2d')!;
		ctx.fillStyle = getComputedStyle(node)[p as 'color'];
		ctx.fillRect(0, 0, 1, 1);
		const d = ctx.getImageData(0, 0, 1, 1).data;
		return [d[0], d[1], d[2]] as Rgb;
	}, prop);
}

function luminance([r, g, b]: Rgb): number {
	const f = (v: number) => {
		const s = v / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: Rgb, b: Rgb): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

test('night theme: Lists chips, tabs and the new-list button are readable @J6.1', async ({
	page,
	context
}, info) => {
	ensureHousehold();
	await asWallDisplay(context);
	await signInAsAdult(page, `e2e-lists-night-${info.project.name}`);
	// Two lists, so one tab is selected and one is not.
	const ids: string[] = [];
	for (const n of ['Night A', 'Night B']) {
		const res = await page.request.post('/api/lists', {
			data: { title: `${n} ${info.project.name}` }
		});
		ids.push(((await res.json()) as { id: string }).id);
	}
	await gotoHydrated(page, `/lists?list=${ids[0]}`);
	await page.evaluate(() => (document.documentElement.dataset.theme = 'night'));
	const selectedChip = page.locator('[data-testid="owner-filter-option"][aria-pressed="true"]');
	const plainChip = page
		.locator('[data-testid="owner-filter-option"][aria-pressed="false"]')
		.first();
	const selectedTab = page.locator('[data-testid="list-tab"][aria-selected="true"]').first();
	const plainTab = page.locator('[data-testid="list-tab"][aria-selected="false"]').first();
	const panel = page.getByTestId('list-panel');
	await expect(selectedChip).toBeVisible();
	await expect(plainTab).toBeVisible();
	await expect(selectedTab).toBeVisible();

	for (const el of [selectedChip, plainChip, selectedTab, plainTab]) {
		const ratio = contrast(await rgbOf(el, 'color'), await rgbOf(el, 'backgroundColor'));
		expect(ratio).toBeGreaterThanOrEqual(4.5);
	}
	// An unselected pill's outline stands apart from what is behind it (WCAG 1.4.11, 3:1).
	const panelBg = await rgbOf(panel, 'backgroundColor');
	const plainOwner = page.locator('[data-testid="owner-option"][aria-pressed="false"]').first();
	expect(contrast(await rgbOf(plainOwner, 'borderTopColor'), panelBg)).toBeGreaterThanOrEqual(3);
	// The dashed + button is outlined in a readable colour, too.
	expect(
		contrast(await rgbOf(page.getByTestId('list-new'), 'borderTopColor'), panelBg)
	).toBeGreaterThanOrEqual(3);
	for (const id of ids) await page.request.delete(`/api/lists/${id}`, { data: {}, maxRetries: 3 });
});
