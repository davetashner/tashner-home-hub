import { mkdirSync } from 'node:fs';
import { expect, test, type Browser, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { hashPin } from '../../src/lib/server/domain/pin';
import { syntheticJpeg } from '../../src/lib/server/photo-cache/fixtures';
import { WAKE_GUARD_MS } from '../../src/lib/domain/wake-guard';
import { PIN, ensureHousehold, signInAsAdult } from './adult';
import { asWallDisplay } from './display';
import { seedCalendar } from './calendar';
import { choreCard, seedKid, type KidSeed } from './kid';

// Tier 2 critical flows (ADR 0002): each test chains several features the way the family uses them.
// Page routes must see every request; a service worker would answer some from the real server.
test.use({ serviceWorkers: 'block' });
test.beforeAll(ensureHousehold);

const MIN = 60_000;
const PHONE = { width: 390, height: 844 };

/** A second device: a phone-sized browser context with its own cookies, so no session is shared with the wall. */
async function openPhone(browser: Browser): Promise<Page> {
	const context = await browser.newContext({
		baseURL: test.info().project.use.baseURL,
		viewport: PHONE,
		serviceWorkers: 'block'
	});
	return context.newPage();
}

/** Seeds an adult with a unique name straight into SQLite (the unlock picker lists adults by name). */
function seedNamedAdult(id: string, name: string): void {
	mkdirSync('data', { recursive: true });
	const db = new Database('data/hub.db');
	db.pragma('busy_timeout = 5000');
	db.prepare(
		"INSERT OR REPLACE INTO members (id, name, role, color, pin_hash) VALUES (?, ?, 'adult', 'member-1', ?)"
	).run(id, name, hashPin(PIN));
	db.close();
}

const card = (page: Page, s: KidSeed) =>
	page.locator(`[data-testid="child-card"][data-member="${s.memberId}"]`);

/** The wall refreshes on a 60 s poll (and when the tab becomes visible again); there is no push channel. */
async function wallRefresh(wall: Page) {
	await wall.clock.fastForward(MIN);
}

/**
 * The kid taps "I did it" on the wall. A tap before the page hydrates is lost, so retry until the
 * card turns pending, then wait until the server has stored it: the tap is optimistic, and a
 * phone that opens the approvals page straight away would otherwise load it before it lands.
 */
async function tapDidIt(wall: Page, s: KidSeed, title: string) {
	const chore = choreCard(wall, title);
	await expect(async () => {
		if ((await chore.getAttribute('data-status')) !== 'pending')
			await chore.getByTestId('did-it').click();
		await expect(chore).toHaveAttribute('data-status', 'pending', { timeout: 1000 });
	}).toPass();
	await expect
		.poll(() => {
			const db = new Database('data/hub.db', { readonly: true });
			try {
				db.pragma('busy_timeout = 5000');
				const row = db
					.prepare(
						"SELECT COUNT(*) AS n FROM chore_completions WHERE member_id = ? AND status = 'pending'"
					)
					.get(s.memberId) as { n: number };
				return row.n;
			} finally {
				db.close();
			}
		})
		.toBe(1);
}

/** Seeds a kid with 2 approved stars and opens the wall's kid screen with a controllable clock. */
async function openWall(wall: Page, s: KidSeed, asWall = false) {
	await wall.context().clearCookies(); // the wall needs no adult session
	if (asWall) await asWallDisplay(wall.context());
	// Pin the idle timers far away so the fast-forwards never send the wall home.
	await wall.route('**/api/settings/idle', (route) =>
		route.request().method() === 'GET'
			? route.fulfill({ json: { homeMinutes: 0, frameMinutes: 60 } })
			: route.fallback()
	);
	await wall.clock.install();
	await wall.goto(`/chores?member=${s.memberId}`);
	await expect(wall.getByTestId('star-jar')).toBeVisible();
	await expect(wall.getByTestId('jar-counts')).toContainText('2 gold stars, 0 waiting');
}

test('chore to gold star: kid taps, parent approves on a phone, the wall shows the star', async ({
	page: wall,
	browser
}, info) => {
	const s = await seedKid(wall, `flow1 ${info.project.name}`);
	await openWall(wall, s);

	// The kid taps "I did it": optimistic pending star on the wall.
	const teeth = choreCard(wall, 'Brush teeth');
	await tapDidIt(wall, s, 'Brush teeth');
	await expect(wall.getByTestId('jar-counts')).toContainText('2 gold stars, 1 waiting');

	// A parent on their own phone, with their own adult session.
	const phone = await openPhone(browser);
	try {
		await signInAsAdult(phone, `adult-flow1-${info.project.name.replace(/\W/g, '')}`);
		await phone.goto('/settings/approvals');
		const row = card(phone, s).getByTestId('approval-row').filter({ hasText: 'Brush teeth' });
		await expect(row).toBeVisible();
		await row.getByTestId('approve').click();
		await expect(row).toHaveCount(0);
		await expect(card(phone, s).getByTestId(`balance-${s.memberId}`)).toHaveText('3 ⭐');

		// The wall picks the approval up on its next refresh.
		await wallRefresh(wall);
		await expect(wall.getByTestId('jar-counts')).toContainText('3 gold stars, 0 waiting');
		await expect(teeth).toHaveAttribute('data-status', 'approved');
	} finally {
		await phone.context().close();
	}
});

test('reward redemption: earn the last star, then a parent redeems with the PIN', async ({
	page: wall,
	browser
}, info) => {
	const s = await seedKid(wall, `flow2 ${info.project.name}`); // 2 stars, adult signed in on `wall`
	const stamp = Date.now() % 1e9;
	const reward = `Sticker book ${info.project.name} ${stamp}`;
	const made = await (
		await wall.request.post('/api/rewards', { data: { title: reward, cost: 3, image: '📒' } })
	).json();
	await wall.request.put(`/api/members/${s.memberId}/goal`, { data: { rewardId: made.id } });
	const parent = `Parent ${info.project.name} ${stamp}`;
	seedNamedAdult(`adult-flow2-${stamp}`, parent);
	await openWall(wall, s);

	// The kid earns the third star on the wall.
	await expect(wall.getByTestId('goal-caption')).toHaveText('2 of 3 stars');
	await tapDidIt(wall, s, 'Brush teeth');
	await expect(wall.getByTestId('jar-counts')).toContainText('2 gold stars, 1 waiting');

	const phone = await openPhone(browser);
	try {
		// Nothing on the phone works without the PIN: the approvals page sends it to unlock first.
		await phone.goto('/settings/approvals');
		await expect(phone).toHaveURL(/\/unlock/);
		// Retry the pick: a tap before the page hydrates is lost.
		await expect(async () => {
			await phone.getByRole('button', { name: parent, exact: true }).click();
			await expect(phone.getByTestId('pinpad')).toBeVisible({ timeout: 1000 });
		}).toPass();
		for (const d of PIN) await phone.getByRole('button', { name: d, exact: true }).click();
		await phone.getByRole('button', { name: 'Enter PIN' }).click();
		await expect(phone).toHaveURL(/\/settings\/approvals/);

		const row = card(phone, s).getByTestId('approval-row').filter({ hasText: 'Brush teeth' });
		await row.getByTestId('approve').click();
		await expect(card(phone, s).getByTestId(`balance-${s.memberId}`)).toHaveText('3 ⭐');

		// The wall now shows the goal reached.
		await wallRefresh(wall);
		await expect(wall.getByTestId('goal-caption')).toHaveText('3 of 3 stars');
		await expect(wall.getByTestId('jar-goal')).toHaveAttribute('data-reached', 'true');

		await card(phone, s).getByTestId('redeem').click();
		await expect(phone.getByTestId('redeem-sheet')).toContainText(reward);
		await phone.getByTestId('redeem-confirm').click();
		await expect(phone.getByTestId('toast')).toContainText(`Redeemed ${reward}`);
		await expect(card(phone, s).getByTestId(`balance-${s.memberId}`)).toHaveText('0 ⭐');

		// It is logged against the PIN's owner.
		// The page re-renders as the redeem settles, which can swallow a tap on the link: retry it.
		await expect(async () => {
			if (!/\/settings\/redemptions/.test(phone.url()))
				await phone.getByTestId('redemption-log-link').click();
			await expect(phone).toHaveURL(/\/settings\/redemptions/, { timeout: 1000 });
		}).toPass();
		const logged = phone.getByTestId('redemption-row').filter({ hasText: reward });
		await expect(logged).toContainText('−3 ⭐');
		await expect(logged).toContainText(`by ${parent}`);

		await wallRefresh(wall);
		await expect(wall.getByTestId('jar-counts')).toContainText('0 gold stars');
	} finally {
		await phone.context().close();
	}
});

test('calendar: agenda, week and month each show the seeded events', async ({ page }) => {
	seedCalendar();
	await page.goto('/calendar');
	await page.waitForLoadState('networkidle');
	const pane = page.getByTestId('calendar-pane');
	const view = page.getByRole('group', { name: 'View' });

	await expect(view.getByRole('button', { name: 'Agenda' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	for (const title of ['Soccer practice', 'Dentist', 'Grandma visits']) {
		await expect(pane.getByText(title).first()).toBeVisible();
	}

	await view.getByRole('button', { name: 'Week' }).click();
	await expect(view.getByRole('button', { name: 'Week' })).toHaveAttribute('aria-pressed', 'true');
	await expect(pane.getByText('Soccer practice')).toBeVisible();
	await expect(pane.getByText('Dentist')).toBeVisible();
	// A multi-day event is one bar on a wide week, and one row per day where narrow weeks list days.
	await expect(pane.getByRole('button', { name: /Grandma visits/ }).first()).toBeVisible();

	await view.getByRole('button', { name: 'Month' }).click();
	await expect(view.getByRole('button', { name: 'Month' })).toHaveAttribute('aria-pressed', 'true');
	await expect(pane.getByText('Grandma visits').first()).toBeVisible();

	await view.getByRole('button', { name: 'Agenda' }).click();
	await expect(view.getByRole('button', { name: 'Agenda' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(pane.getByText('Dentist').first()).toBeVisible();
});

test('photo frame: idle goes home, then the frame shows a photo; a touch leaves it', async ({
	page
}, info) => {
	await asWallDisplay(page.context()); // idle behaviour is for wall displays (DEV-1)
	// This page gets its own synthetic photo and idle timers, so other tests never leak in.
	const photo = { id: `critical-${info.project.name}`, w: 640, h: 360 };
	const jpeg = await syntheticJpeg(photo.w, photo.h);
	await page.route(/\/api\/photo\/[^/?]+\?/, (route) => {
		const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop()!);
		if (id !== photo.id) return route.fallback();
		if (new URL(route.request().url()).searchParams.get('part') === 'bg')
			return route.fulfill({ status: 404 });
		return route.fulfill({ contentType: 'image/jpeg', body: jpeg });
	});
	await page.route('**/api/photo/slideshow?**', (route) => route.fulfill({ json: [photo] }));
	await page.route('**/api/settings/slideshow', (route) =>
		route.request().method() === 'GET'
			? route.fulfill({ json: { intervalSeconds: 30, transition: 'fade' } })
			: route.fallback()
	);
	await page.route('**/api/settings/idle', (route) =>
		route.request().method() === 'GET'
			? route.fulfill({ json: { homeMinutes: 2, frameMinutes: 5 } })
			: route.fallback()
	);
	await page.clock.install();
	await page.goto('/meals');
	await page.waitForLoadState('networkidle');

	await page.clock.fastForward(2 * MIN);
	await expect(page).toHaveURL(/:\d+\/$/);

	await page.clock.fastForward(5 * MIN);
	await expect(page).toHaveURL(/\/photos$/);
	const front = page.getByTestId('slideshow').locator('[data-front="true"]');
	await expect(front).toHaveAttribute('data-photo-id', photo.id);

	// The waking touch only wakes.
	await page.mouse.click(10, 10);
	await expect(page).toHaveURL(/:\d+\/$/);
});

test('sleep now, then the touch that wakes the display does not press the chore under it', async ({
	page: wall
}, info) => {
	const s = await seedKid(wall, `flow-wake ${info.project.name}`);
	// The sleep state is shared by the whole server, so the display API is answered here:
	// "Sleep" turns the reported power off, and the Pi agent's wake turns it back on.
	let power: 'on' | 'off' = 'on';
	await wall.route('**/api/display/power', (route) =>
		route.fulfill({
			json: {
				power,
				reason: power === 'off' ? 'sleep-now' : 'schedule',
				mode: power === 'off' ? 'off' : 'normal'
			}
		})
	);
	await wall.route('**/api/display/sleep', (route) => {
		power = 'off';
		return route.fulfill({ json: { power, reason: 'sleep-now' } });
	});
	await openWall(wall, s, true);

	await wall.getByRole('button', { name: 'Sleep' }).click();
	await expect
		.poll(() => wall.evaluate(() => fetch('/api/display/power').then((r) => r.json())))
		.toEqual({ power: 'off', reason: 'sleep-now', mode: 'off' });
	const asleep = wall.waitForResponse('**/api/display/power');
	await wall.clock.fastForward(1000); // the guard's poll sees the display off
	await asleep;

	// The agent wakes the screen; the same touch reaches the page right after.
	power = 'on';
	const seen = wall.waitForResponse('**/api/display/power');
	await wall.clock.fastForward(1000);
	await seen;
	const teeth = choreCard(wall, 'Brush teeth');
	await teeth.getByTestId('did-it').click();
	await expect(teeth).not.toHaveAttribute('data-status', 'pending');
	await expect(wall.getByTestId('jar-counts')).toContainText('2 gold stars, 0 waiting');

	// A later tap, once the guard window has passed, works as normal.
	await wall.clock.fastForward(WAKE_GUARD_MS + 100);
	await teeth.getByTestId('did-it').click();
	await expect(teeth).toHaveAttribute('data-status', 'pending');
});
