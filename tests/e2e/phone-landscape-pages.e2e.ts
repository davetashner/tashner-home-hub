import { expect, test, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { ensureHousehold, signInAsAdult } from './adult';
import { seedKid, type KidSeed } from './kid';
import { px } from './tap';
import { gotoHydrated } from './hydrated';
import { DB_PATH } from './data-dir';

// DEV-1/UI-8: every page works on an iPhone turned sideways (only ~290px of height under the
// compact top bar): nothing scrolls sideways, headings fit, controls are tap-sized (96px on the
// kid screen), the first chore shows without scrolling, and celebrations stay on screen.
// Each test sets the viewports itself, so the two wall projects split them between them.
test.beforeAll(ensureHousehold);

type Viewport = { width: number; height: number };
const landscape: Viewport[] = [
	{ width: 852, height: 393 },
	{ width: 667, height: 375 }
];
const portrait: Viewport[] = [
	{ width: 932, height: 430 },
	{ width: 852, height: 393 }
];
const viewportsFor = (project: string) => (project.includes('portrait') ? portrait : landscape);
const label = (vp: Viewport) => `${vp.width}x${vp.height}`;

const routes = [
	'/',
	'/calendar',
	'/photos',
	'/lists',
	'/meals',
	'/settings',
	'/settings/approvals',
	'/settings/family',
	'/settings/calendars',
	'/settings/chores',
	'/settings/rewards',
	'/settings/redemptions',
	'/settings/screen',
	'/settings/sleep-schedule',
	'/settings/sound',
	'/settings/time-zone',
	'/settings/orientation',
	'/settings/photo-library'
];

async function settle(page: Page) {
	await page.waitForLoadState('networkidle');
	await page.evaluate(async () => {
		await document.fonts.ready;
		await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)));
	});
}

/** Nothing wider than the screen, and the page heading stays inside its container. */
async function expectFits(page: Page) {
	const result = await page.evaluate(() => {
		const doc = document.documentElement;
		const main = document.querySelector('main');
		const h1 = document.querySelector('main h1:not(.sr-only)');
		const box = h1?.getBoundingClientRect();
		const host = h1?.parentElement?.getBoundingClientRect();
		return {
			page: doc.scrollWidth - window.innerWidth,
			main: main ? main.scrollWidth - main.clientWidth : 0,
			h1Own: h1 ? h1.scrollWidth - h1.clientWidth : 0,
			h1Right: box && host ? box.right - host.right : 0,
			h1Left: box ? box.left : 0
		};
	});
	expect(result.page, 'page scrolls sideways').toBeLessThanOrEqual(0);
	expect(result.main, 'main scrolls sideways').toBeLessThanOrEqual(0);
	expect(result.h1Own, 'h1 text overflows its box').toBeLessThanOrEqual(0);
	expect(result.h1Right, 'h1 overflows its container').toBeLessThanOrEqual(1);
	expect(result.h1Left, 'h1 starts off screen').toBeGreaterThanOrEqual(0);
}

/** Visible interactive elements in the viewport smaller than `min`. */
async function smallTargets(page: Page, min: number): Promise<string[]> {
	return page.evaluate((min) => {
		const sel =
			'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=switch], [role=tab]';
		const vw = document.documentElement.clientWidth;
		const vh = document.documentElement.clientHeight;
		const out: string[] = [];
		for (const el of document.querySelectorAll(sel)) {
			if ((el as HTMLButtonElement).disabled) continue;
			if (el.closest('[hidden], [inert], [aria-hidden=true], details:not([open]) > :not(summary)'))
				continue;
			const style = getComputedStyle(el);
			if (style.visibility === 'hidden' || style.display === 'none') continue;
			const r = el.getBoundingClientRect();
			if (r.width === 0 || r.height === 0) continue;
			if (r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) continue;
			const w = Math.round(r.width * 100) / 100;
			const h = Math.round(r.height * 100) / 100;
			if (w < min || h < min) {
				const name = (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40);
				out.push(`<${el.tagName.toLowerCase()}> "${name}" is ${w}x${h}px`);
			}
		}
		return out;
	}, min);
}

/** A kid with chores to do and a goal, plus a sibling so the child switcher shows. */
async function seedChoresKid(page: Page, tag: string): Promise<KidSeed> {
	const kid = await seedKid(page, `phone-${tag}`, ['Tidy room', 'Read book']);
	await seedKid(page, `phone2-${tag}`);
	const reward = await (
		await page.request.post('/api/rewards', {
			data: { title: `Phone reward ${Date.now() % 1e9}`, cost: 5, image: '🧺' }
		})
	).json();
	await page.request.put(`/api/members/${kid.memberId}/goal`, { data: { rewardId: reward.id } });
	return kid;
}

for (const route of routes) {
	test(`phone landscape: ${route} fits with tap-sized controls`, async ({ page }, info) => {
		await signInAsAdult(page, `adult-phone-${info.project.name}`);
		for (const vp of viewportsFor(info.project.name)) {
			await test.step(label(vp), async () => {
				await page.setViewportSize(vp);
				await gotoHydrated(page, route);
				await settle(page);
				await expectFits(page);
				expect(await smallTargets(page, 60)).toEqual([]);
			});
		}
	});
}

test('phone landscape: /chores shows the first chore to do without scrolling', async ({
	page
}, info) => {
	await signInAsAdult(page, `adult-phone-${info.project.name}`);
	for (const vp of viewportsFor(info.project.name)) {
		await test.step(label(vp), async () => {
			await page.setViewportSize(vp);
			const kid = await seedChoresKid(page, `${label(vp)}-${info.project.name}`);
			await gotoHydrated(page, `/chores?member=${kid.memberId}`);
			await expect(page.getByTestId('star-jar')).toBeVisible();
			await settle(page);
			await expectFits(page);

			// Kid controls (the chore buttons and the child switcher) are 96px; the rest are 60px.
			const kidControls = page
				.locator('[data-testid="did-it"], [data-testid="undo"]')
				.or(page.getByTestId('child-switcher').getByRole('button'));
			for (const control of await kidControls.all()) {
				const box = await control.boundingBox();
				if (!box) continue;
				expect(px(box.width)).toBeGreaterThanOrEqual(96);
				expect(px(box.height)).toBeGreaterThanOrEqual(96);
			}
			expect(await smallTargets(page, 60)).toEqual([]);

			const first = page.getByTestId('did-it').first();
			const box = (await first.boundingBox())!;
			const main = (await page.locator('main').boundingBox())!;
			expect(box.y, 'first "I did it" starts above the screen').toBeGreaterThanOrEqual(main.y);
			expect(box.y + box.height, 'first "I did it" needs scrolling').toBeLessThanOrEqual(
				main.y + main.height
			);
			expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
			expect(px(box.height)).toBeGreaterThanOrEqual(96);
		});
	}
});

test('phone landscape: /chores celebration banner stays on screen', async ({ page }, info) => {
	await signInAsAdult(page, `adult-phone-${info.project.name}`);
	for (const vp of viewportsFor(info.project.name)) {
		await test.step(label(vp), async () => {
			await page.setViewportSize(vp);
			const kid = await seedChoresKid(page, `done-${label(vp)}-${info.project.name}`);
			await gotoHydrated(page, `/chores?member=${kid.memberId}`);
			await expect(page.getByTestId('star-jar')).toBeVisible();
			await settle(page);
			const todo = await page.getByTestId('did-it').count();
			for (let i = 0; i < todo; i++) {
				const btn = page.getByTestId('did-it').first();
				await expect(async () => {
					const before = await page.getByTestId('did-it').count();
					await btn.click();
					await expect(page.getByTestId('did-it')).toHaveCount(before - 1, { timeout: 1000 });
				}).toPass();
			}
			const banner = page.getByTestId('all-done');
			await expect(banner).toBeVisible();
			await page.waitForTimeout(700);
			const box = (await banner.boundingBox())!;
			expect(box.x).toBeGreaterThanOrEqual(0);
			expect(box.y).toBeGreaterThanOrEqual(0);
			expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
			expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
		});
	}
});

test('phone landscape: /chores "you earned it" banner stays on screen', async ({ page }, info) => {
	await signInAsAdult(page, `adult-phone-${info.project.name}`);
	for (const vp of viewportsFor(info.project.name)) {
		await test.step(label(vp), async () => {
			await page.setViewportSize(vp);
			// The seeded kid starts with 2 gold stars, so a 2-star goal is already reached.
			const kid = await seedKid(page, `earned-${label(vp)}-${info.project.name}`);
			const reward = await (
				await page.request.post('/api/rewards', {
					data: { title: `Earned ${Date.now() % 1e9}`, cost: 2, image: '🧺' }
				})
			).json();
			await page.request.put(`/api/members/${kid.memberId}/goal`, {
				data: { rewardId: reward.id }
			});
			await gotoHydrated(page, `/chores?member=${kid.memberId}`);
			const banner = page.getByTestId('goal-earned');
			await expect(banner).toBeVisible();
			await page.waitForTimeout(700);
			const box = (await banner.boundingBox())!;
			expect(box.x).toBeGreaterThanOrEqual(0);
			expect(box.y).toBeGreaterThanOrEqual(0);
			expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
			expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
		});
	}
});

test('phone landscape: a three-digit approvals count keeps the adult header on screen', async ({
	page
}, info) => {
	// CI's shared database can hold 100+ pending approvals; the badge caps its count at "99+" so
	// the header (with Lock, for an adult) still fits the narrowest phone.
	const kid = await seedKid(page, `phone-badge-${info.project.name}`);
	const db = new Database(DB_PATH);
	db.pragma('busy_timeout = 5000');
	const insert = db.prepare(
		"INSERT INTO chore_completions (id, chore_id, member_id, date, completed_at, status) VALUES (?, ?, ?, '2019-01-01', 0, 'pending')"
	);
	const choreId = Object.values(kid.chores)[0];
	db.transaction(() => {
		for (let i = 0; i < 120; i++) insert.run(`badge-${kid.memberId}-${i}`, choreId, kid.memberId);
	})();
	db.close();
	await signInAsAdult(page, `adult-phone-${info.project.name}`);
	await page.setViewportSize({ width: 667, height: 375 });
	await gotoHydrated(page, '/calendar');
	await settle(page);
	// innerText skips the hidden wall-size label, so this is what the phone actually shows.
	await expect
		.poll(() =>
			page.getByTestId('approvals-badge').evaluate((el) => (el as HTMLElement).innerText.trim())
		)
		.toBe('99+');
	await expectFits(page);
});
