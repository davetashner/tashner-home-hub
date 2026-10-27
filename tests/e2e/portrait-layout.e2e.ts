import { expect, test, type Page } from '@playwright/test';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { ensureHousehold, signInAsAdult } from './adult';
import { gotoHydrated } from './hydrated';

// ADR 0002 Tier 2 (visual regression row, minus screenshots): no portrait layout may scroll
// horizontally or clip a control. Vertical scroll is fine; horizontal clipping is not.
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
const viewports = [
	{ width: 1080, height: 1920 },
	{ width: 1440, height: 2560 }
];
const TOLERANCE = 1;

interface Rect {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

/** Runs in the page: returns human-readable problems (empty when the layout is sound). */
async function findLayoutProblems(page: Page, tolerance: number): Promise<string[]> {
	return page.evaluate((tol) => {
		const problems: string[] = [];
		const fmt = (r: Rect) =>
			`[x ${Math.round(r.left)}..${Math.round(r.right)}, y ${Math.round(r.top)}..${Math.round(r.bottom)}]`;
		const describe = (el: Element) => {
			const label =
				el.getAttribute('aria-label') ||
				(el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40) ||
				(el as HTMLInputElement).placeholder ||
				el.getAttribute('name') ||
				'';
			const cls = (el.getAttribute('class') ?? '').split(/\s+/).slice(0, 3).join('.');
			return `<${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}> "${label}"`;
		};

		const root = document.documentElement;
		if (root.scrollWidth > root.clientWidth + tol)
			problems.push(
				`document scrolls horizontally: scrollWidth ${root.scrollWidth} > clientWidth ${root.clientWidth}`
			);
		if (document.body.scrollWidth > root.clientWidth + tol)
			problems.push(
				`body scrolls horizontally: scrollWidth ${document.body.scrollWidth} > ${root.clientWidth}`
			);
		const main = document.querySelector('main');
		if (main && main.scrollWidth > main.clientWidth + tol)
			problems.push(
				`<main> scrolls horizontally: scrollWidth ${main.scrollWidth} > clientWidth ${main.clientWidth}`
			);

		const vw = root.clientWidth;
		const selector =
			'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=tab], [role=switch], [role=checkbox], [tabindex]';
		for (const el of document.querySelectorAll(selector)) {
			if (el === main) continue; // the scroll container itself
			if (
				el.getAttribute('tabindex') === '-1' &&
				!/^(button|a|input|select|textarea)$/i.test(el.tagName)
			)
				continue;
			const style = getComputedStyle(el);
			if (style.visibility === 'hidden' || style.display === 'none') continue;
			if (Number(style.opacity) === 0 || el.closest('[hidden], [inert], [aria-hidden=true]'))
				continue;
			const r = el.getBoundingClientRect();
			if (r.width < 2 || r.height < 2) continue; // sr-only / collapsed
			const rect = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };

			if (rect.left < -tol || rect.right > vw + tol) {
				problems.push(
					`${describe(el)} extends outside the viewport horizontally ${fmt(rect)} (viewport width ${vw})`
				);
				continue;
			}
			for (let anc = el.parentElement; anc; anc = anc.parentElement) {
				const s = getComputedStyle(anc);
				const clipsX = s.overflowX === 'hidden' || s.overflowX === 'clip';
				const clipsY = s.overflowY === 'hidden' || s.overflowY === 'clip';
				if (!clipsX && !clipsY) continue;
				const a = anc.getBoundingClientRect();
				// Entirely outside the clip box means deliberately hidden (off-canvas), not cut off.
				const outside =
					r.right <= a.left || r.left >= a.right || r.bottom <= a.top || r.top >= a.bottom;
				if (outside) break;
				const cutX = clipsX && (r.left < a.left - tol || r.right > a.right + tol);
				const cutY = clipsY && (r.top < a.top - tol || r.bottom > a.bottom + tol);
				if (cutX || cutY) {
					problems.push(
						`${describe(el)} ${fmt(rect)} is clipped by ancestor ${describe(anc)} ${fmt(a)} (overflow ${s.overflowX}/${s.overflowY})`
					);
					break;
				}
			}
		}
		return problems;
	}, tolerance);
}

async function settle(page: Page): Promise<void> {
	await page.waitForLoadState('networkidle');
	await page.evaluate(async () => {
		await document.fonts.ready;
		// Seasonal sprites loop forever; wait only for animations that end.
		const ends = (a: Animation) => Number.isFinite(a.effect?.getComputedTiming().endTime);
		await Promise.all(
			document
				.getAnimations()
				.filter(ends)
				.map((a) => a.finished.catch(() => undefined))
		);
	});
}

test.beforeAll(ensureHousehold);

test('route discovery finds the home page and settings sub-pages @J16.2', () => {
	expect(routes).toContain('/');
	expect(routes).toContain('/settings/family');
});

// The landscape project checks the 1080x1920 portrait size and the portrait project checks
// 1440x2560, so both sizes are covered without duplicate work and without skipped tests.
const viewportFor = (projectName: string) =>
	projectName === 'wall-landscape-1440p' ? viewports[0] : viewports[1];

test.describe('portrait layout has no horizontal overflow or clipped controls', () => {
	for (const route of routes) {
		test(`${route} @J16.2`, async ({ page }, testInfo) => {
			const viewport = viewportFor(testInfo.project.name);
			await page.setViewportSize(viewport);
			await signInAsAdult(page, 'e2e-portrait-adult');
			await gotoHydrated(page, route);
			await settle(page);
			const landed = new URL(page.url()).pathname;
			const problems = await findLayoutProblems(page, TOLERANCE);
			expect(
				problems,
				`route ${route} (landed on ${landed}) at ${viewport.width}x${viewport.height}`
			).toEqual([]);
		});
	}
});
