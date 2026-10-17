import { expect, test, type Page } from '@playwright/test';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { ensureHousehold } from './adult';
import { seedKid } from './kid';
import { px } from './tap';

// ADR 0002 Tier 2 (kid-friendly touch): every interactive element on every screen is at least
// 60px in both dimensions, and 96px on kid screens. Each project is measured at its own wall
// viewport, so both orientations are covered. Phones are covered by other tests.
//
// Hover-only interactions are not checked: telling "content only appears on :hover" apart from
// ordinary hover styling cannot be done reliably from computed styles, so it is left to review.
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
const MIN = 60;
const KID_MIN = 96;

/** Screens a child uses on their own: the chores screen (cards, undo, star jar and goal). */
const KID_ROUTES = new Set(['/chores']);

/** Not measured, each with a reason. Keep this tiny. */
const EXCLUDED_SELECTORS: string[] = [];

interface Offender {
	tag: string;
	name: string;
	width: number;
	height: number;
	min: number;
}

/** Runs in the page: interactive, visible, enabled elements smaller than `min` in either dimension. */
async function findSmallTargets(page: Page, min: number, excluded: string[]): Promise<Offender[]> {
	return page.evaluate(
		({ min, excluded }) => {
			const selector = [
				'button',
				'a[href]',
				'input:not([type=hidden])',
				'select',
				'textarea',
				'summary',
				'[role=button]',
				'[role=link]',
				'[role=tab]',
				'[role=switch]',
				'[role=checkbox]',
				'[role=radio]',
				'[role=menuitem]',
				'[tabindex]:not([tabindex="-1"])'
			].join(',');
			const vw = document.documentElement.clientWidth;
			const vh = document.documentElement.clientHeight;
			const out: { tag: string; name: string; width: number; height: number; min: number }[] = [];
			const nameOf = (el: Element) => {
				const labelled = el.getAttribute('aria-label') || el.getAttribute('title');
				const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ');
				const input = el as HTMLInputElement;
				return (
					labelled ||
					text ||
					input.placeholder ||
					el.getAttribute('name') ||
					el.getAttribute('data-testid') ||
					''
				).slice(0, 50);
			};
			for (const el of document.querySelectorAll(selector)) {
				if (excluded.length && el.matches(excluded.join(','))) continue;
				if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true')
					continue;
				if (el.closest('[hidden], [inert], [aria-hidden=true]')) continue;
				const closedDetails = el.closest('details:not([open])');
				if (closedDetails && !(el.tagName === 'SUMMARY' && el.parentElement === closedDetails))
					continue;
				const style = getComputedStyle(el);
				if (style.visibility === 'hidden' || style.display === 'none') continue;
				if (Number(style.opacity) === 0) continue;
				const r = el.getBoundingClientRect();
				if (r.width === 0 || r.height === 0) continue;
				// Fully outside the viewport (off-canvas, scrolled away) is not a tap target now.
				if (r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) continue;
				// A scrolled-away part of a long list is still a target; only rect size matters.
				const w = Math.round(r.width * 100) / 100;
				const h = Math.round(r.height * 100) / 100;
				if (w < min || h < min)
					out.push({ tag: el.tagName.toLowerCase(), name: nameOf(el), width: w, height: h, min });
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

let kidId = '';

test.beforeAll(ensureHousehold);

test('route discovery finds the home page, chores and settings sub-pages', () => {
	expect(routes).toContain('/');
	expect(routes).toContain('/chores');
	expect(routes).toContain('/settings/family');
	for (const r of KID_ROUTES) expect(routes).toContain(r);
});

test.describe('every interactive element meets the tap-target minimum', () => {
	for (const route of routes) {
		test(`${route}`, async ({ page }, testInfo) => {
			// Adult signed in, with a kid who has chores (one pending approval) and a goal reward.
			const seed = await seedKid(page, `tap ${testInfo.project.name}`);
			kidId = seed.memberId;
			await page.request.post(`/api/chores/${seed.chores['Brush teeth']}/complete`, {
				data: { memberId: seed.memberId }
			});
			const reward = await (
				await page.request.post('/api/rewards', {
					data: { title: `Tap reward ${Date.now() % 1e9}`, cost: 5, image: '🧺' }
				})
			).json();
			await page.request.put(`/api/members/${seed.memberId}/goal`, {
				data: { rewardId: reward.id }
			});

			const isKid = KID_ROUTES.has(route);
			const url = isKid ? `${route}?member=${kidId}` : route;
			await page.goto(url);
			await settle(page);
			const landed = new URL(page.url()).pathname;
			const min = isKid ? KID_MIN : MIN;
			const small = await findSmallTargets(page, min, EXCLUDED_SELECTORS);
			const vp = page.viewportSize()!;
			expect(
				small.map(
					(o) => `<${o.tag}> "${o.name}" is ${px(o.width)}x${px(o.height)}px (needs ${o.min}px)`
				),
				`route ${route} (landed on ${landed}) at ${vp.width}x${vp.height}${isKid ? ' [kid screen]' : ''}`
			).toEqual([]);
		});
	}
});
