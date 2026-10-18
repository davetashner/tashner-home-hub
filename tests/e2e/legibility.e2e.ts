import { expect, test, type Page } from '@playwright/test';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { ensureHousehold } from './adult';
import { seedKid } from './kid';
import { gotoHydrated } from './hydrated';

// ADR 0002 Tier 2 (readable from across the room, UI-3): on the wall screens (1440p, both
// orientations) no visible text is under 24px, and the clock/date headers are at least the
// size their design tokens set. Contrast is covered by axe in a11y.e2e.ts. Captions count as
// body text, so the caption token's floor is also 24px at 1440p. Phones are not wall screens
// and are not measured here.
const routesDir = path.resolve('src/routes');

/** URL paths for every directory under src/routes that has a +page.svelte (same walk as a11y). */
function discoverRoutes(dir = routesDir, urlPath = ''): string[] {
	const entries = readdirSync(dir, { withFileTypes: true });
	const routes = entries.some((e) => e.isFile() && e.name === '+page.svelte')
		? [urlPath || '/']
		: [];
	for (const e of entries) {
		if (!e.isDirectory()) continue;
		if (/^\[.*\]$/.test(e.name)) continue;
		const isGroup = /^\(.*\)$/.test(e.name);
		routes.push(
			...discoverRoutes(path.join(dir, e.name), isGroup ? urlPath : `${urlPath}/${e.name}`)
		);
	}
	return routes;
}

const routes = discoverRoutes();
const MIN_PX = 24;

/** Screens that need a child selected to show real content. */
const KID_ROUTES = new Set(['/chores']);

/** Text exempt from the minimum, each with a reason. Keep this tiny. */
const EXCLUDED_SELECTORS: string[] = [];

/** Runs in the page: visible text nodes whose computed font size is under `min`. */
async function findSmallText(page: Page, min: number, excluded: string[]): Promise<string[]> {
	return page.evaluate(
		({ min, excluded }) => {
			const vw = document.documentElement.clientWidth;
			const vh = document.documentElement.clientHeight;
			const skipTags = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TITLE', 'OPTION']);
			const out: string[] = [];
			const describe = (el: Element) => {
				const id = el.getAttribute('data-testid');
				const cls = (el.getAttribute('class') ?? '').trim().split(/\s+/).slice(0, 4).join('.');
				return `<${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}${id ? ` data-testid=${id}` : ''}>`;
			};
			const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
			for (let n = walker.nextNode(); n; n = walker.nextNode()) {
				const text = (n.nodeValue ?? '').trim().replace(/\s+/g, ' ');
				const el = n.parentElement;
				if (!text || !el || skipTags.has(el.tagName)) continue;
				if (el.closest('svg, [aria-hidden=true], [hidden], [inert]')) continue;
				if (excluded.length && el.closest(excluded.join(','))) continue;
				if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
				// Visually hidden (sr-only): clipped to a 1px box.
				let hidden = false;
				for (let a: Element | null = el; a && a !== document.body; a = a.parentElement) {
					const s = getComputedStyle(a);
					const r = a.getBoundingClientRect();
					if (s.position === 'absolute' && r.width <= 1 && r.height <= 1) hidden = true;
				}
				if (hidden) continue;
				const range = document.createRange();
				range.selectNodeContents(n);
				const r = range.getBoundingClientRect();
				if (r.width === 0 || r.height === 0) continue;
				if (r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) continue;
				const size = parseFloat(getComputedStyle(el).fontSize);
				if (size < min)
					out.push(`"${text.slice(0, 40)}" ${describe(el)} is ${Math.round(size * 100) / 100}px`);
			}
			return out;
		},
		{ min, excluded }
	);
}

async function settle(page: Page): Promise<void> {
	await page.waitForLoadState('networkidle');
	await page.evaluate(async () => {
		await document.fonts.ready;
		await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)));
	});
}

/** Computed px of a type token at this viewport, resolved through a probe element. */
async function tokenPx(page: Page, token: string): Promise<number> {
	return page.evaluate((token) => {
		const probe = document.createElement('div');
		probe.style.fontSize = `var(${token})`;
		probe.style.position = 'absolute';
		document.body.appendChild(probe);
		const size = parseFloat(getComputedStyle(probe).fontSize);
		probe.remove();
		return size;
	}, token);
}

async function fontPx(page: Page, testid: string): Promise<number> {
	return page
		.getByTestId(testid)
		.first()
		.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
}

test.beforeAll(ensureHousehold);

test('route discovery finds the home page, chores and settings sub-pages @J16.2', () => {
	expect(routes).toContain('/');
	expect(routes).toContain('/chores');
	expect(routes).toContain('/settings/family');
});

test.describe('all visible text is at least 24px on the wall', () => {
	for (const route of routes) {
		test(`${route} @J16.2`, async ({ page }, testInfo) => {
			const seed = await seedKid(page, `leg ${testInfo.project.name}`);
			await page.request.post(`/api/chores/${seed.chores['Brush teeth']}/complete`, {
				data: { memberId: seed.memberId }
			});
			const reward = await (
				await page.request.post('/api/rewards', {
					data: { title: `Legible reward ${Date.now() % 1e9}`, cost: 5, image: '🧺' }
				})
			).json();
			await page.request.put(`/api/members/${seed.memberId}/goal`, {
				data: { rewardId: reward.id }
			});

			await gotoHydrated(page, KID_ROUTES.has(route) ? `${route}?member=${seed.memberId}` : route);
			await settle(page);
			const landed = new URL(page.url()).pathname;
			const small = await findSmallText(page, MIN_PX, EXCLUDED_SELECTORS);
			const vp = page.viewportSize()!;
			expect(
				small,
				`route ${route} (landed on ${landed}) at ${vp.width}x${vp.height}, text under ${MIN_PX}px`
			).toEqual([]);
		});
	}
});

test.describe('clock and date are at least their token sizes', () => {
	test('header clock and date @J16.2', async ({ page }) => {
		await gotoHydrated(page, '/chores');
		await settle(page);
		const vp = page.viewportSize()!;
		const where = `${vp.width}x${vp.height}`;
		expect(
			await fontPx(page, 'header-clock-time'),
			`header time at ${where}`
		).toBeGreaterThanOrEqual(await tokenPx(page, '--text-headline'));
		expect(
			await fontPx(page, 'header-clock-date'),
			`header date at ${where}`
		).toBeGreaterThanOrEqual(await tokenPx(page, '--text-lead'));
	});

	test('hero clock and date on home @J16.2', async ({ page }) => {
		await gotoHydrated(page, '/');
		await settle(page);
		const vp = page.viewportSize()!;
		const where = `${vp.width}x${vp.height}`;
		await expect(page.getByTestId('clock-time'), `hero clock on home at ${where}`).toBeVisible();
		expect(await fontPx(page, 'clock-time'), `hero time at ${where}`).toBeGreaterThanOrEqual(
			await tokenPx(page, '--text-display')
		);
		expect(await fontPx(page, 'clock-date'), `hero date at ${where}`).toBeGreaterThanOrEqual(
			await tokenPx(page, '--text-title')
		);
	});
});
