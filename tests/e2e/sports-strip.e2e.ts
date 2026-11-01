import { expect, test, type Page } from '@playwright/test';
import { ensureHousehold } from './adult';
import { gotoHydrated } from './hydrated';

test.use({ serviceWorkers: 'block' });
test.beforeAll(ensureHousehold);

// Mid-day for US zones, so "today" holds whichever household zone the e2e server picked.
const NOW = Date.parse('2030-01-06T16:00:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

const TEAMS = [
	{ id: 'nfl:bal', league: 'nfl', abbr: 'BAL', name: 'Ravens' },
	{ id: 'nfl:wsh', league: 'nfl', abbr: 'WSH', name: 'Commanders' },
	{ id: 'nhl:wsh', league: 'nhl', abbr: 'WSH', name: 'Capitals' }
];

function game(team: string, over: Record<string, unknown>) {
	return {
		id: `${team}-${over.start}`,
		league: team.startsWith('nhl') ? 'nhl' : 'nfl',
		team,
		opponent: { name: 'Testville Rockets', abbr: 'TST' },
		home: true,
		status: 'scheduled',
		teamScore: null,
		opponentScore: null,
		period: null,
		clock: null,
		channel: 'CBS',
		...over
	};
}

async function open(page: Page, games: unknown[]) {
	await page.route('**/api/sports', (route) =>
		route.fulfill({ json: { teams: TEAMS, games, updatedAt: NOW } })
	);
	await page.clock.setFixedTime(NOW);
	await gotoHydrated(page, '/');
}

async function shot(page: Page, name: string, testInfo: { project: { name: string } }) {
	const dir = process.env.SPORTS_SHOTS;
	if (!dir) return;
	await page.waitForTimeout(600); // let the page-enter fade finish
	const orientation = testInfo.project.name.includes('portrait') ? 'portrait' : 'landscape';
	await page.screenshot({ path: `${dir}/strip-${name}-${orientation}.png` });
}

const strip = (page: Page) => page.getByTestId('sports-strip');
const card = (page: Page, team: string) => strip(page).locator(`[data-team="${team}"]`);

test('normal: a compact card per team with a game in 10 days @J0.2', async ({ page }, info) => {
	await open(page, [
		game('nfl:bal', { start: iso(4 * 24 * HOUR), channel: 'FOX' }),
		game('nfl:wsh', { start: iso(5 * 24 * HOUR), home: false, channel: null }),
		game('nhl:wsh', { start: iso(40 * 24 * HOUR) })
	]);
	await expect(strip(page)).toBeVisible();
	await expect(strip(page).getByTestId('sports-card')).toHaveCount(2);
	await expect(card(page, 'nfl:bal')).toContainText('Ravens vs Rockets');
	await expect(card(page, 'nfl:bal')).toContainText('FOX');
	await expect(card(page, 'nfl:wsh')).toContainText('Commanders at Rockets');
	await expect(card(page, 'nfl:bal')).toHaveAttribute('data-state', 'normal');
	await expect(card(page, 'nhl:wsh')).toHaveCount(0);
	await shot(page, 'normal', info);
});

test('game day: a big card with a kickoff countdown @J0.2', async ({ page }, info) => {
	await open(page, [
		game('nfl:bal', { start: iso(2 * HOUR + 15 * MIN) }),
		game('nhl:wsh', { start: iso(3 * 24 * HOUR) })
	]);
	const bal = card(page, 'nfl:bal');
	await expect(bal).toHaveAttribute('data-state', 'today');
	await expect(bal.getByTestId('sports-eyebrow')).toHaveText('Today');
	await expect(bal.getByTestId('sports-countdown')).toContainText('2h 15m');
	await expect(bal.getByTestId('sports-countdown')).toContainText('to kickoff');
	await expect(card(page, 'nhl:wsh')).toHaveAttribute('data-state', 'normal');
	// the game-day card comes first and is the bigger one
	await expect(strip(page).getByTestId('sports-card').first()).toHaveAttribute(
		'data-team',
		'nfl:bal'
	);
	const [big, small] = await Promise.all([bal.boundingBox(), card(page, 'nhl:wsh').boundingBox()]);
	const portrait = info.project.name.includes('portrait');
	expect(portrait ? big!.height : big!.width).toBeGreaterThan(
		portrait ? small!.height : small!.width
	);
	await shot(page, 'gameday', info);
});

test('live: pulsing status and the score, team first @J0.2', async ({ page }, info) => {
	await open(page, [
		game('nfl:bal', {
			start: iso(-HOUR),
			status: 'live',
			teamScore: 17,
			opponentScore: 10,
			period: 'Q3',
			clock: '8:42'
		}),
		game('nfl:wsh', { start: iso(6 * HOUR), home: false })
	]);
	const bal = card(page, 'nfl:bal');
	await expect(bal.getByTestId('sports-eyebrow')).toHaveText('Live · Q3 8:42');
	await expect(bal.getByTestId('sports-score')).toHaveText('17–10');
	const dot = bal.locator('.live-dot');
	await expect(dot).toHaveCSS('animation-name', 'live-pulse');
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await expect(dot).toHaveCSS('animation-name', 'none');
	await page.emulateMedia({ reducedMotion: 'no-preference' });
	await shot(page, 'live', info);
});

test('final: score line, W pill and the next game @J0.2', async ({ page }, info) => {
	await open(page, [
		game('nfl:bal', { start: iso(-4 * HOUR), status: 'final', teamScore: 24, opponentScore: 17 }),
		game('nfl:bal', { start: iso(4 * 24 * HOUR), home: false }),
		game('nfl:wsh', {
			start: iso(-4 * HOUR),
			status: 'final',
			teamScore: 16,
			opponentScore: 20
		})
	]);
	const bal = card(page, 'nfl:bal');
	await expect(bal.getByTestId('sports-title')).toHaveText('Final: Ravens 24, Rockets 17');
	await expect(bal).toContainText('Next:');
	await expect(bal).toContainText('at Rockets');
	await expect(bal.getByTestId('sports-result')).toHaveText('W');
	await expect(card(page, 'nfl:wsh').getByTestId('sports-result')).toHaveText('L');
	await shot(page, 'final', info);
});

test('no games: the strip renders nothing', async ({ page }) => {
	await open(page, []);
	await expect(page.getByTestId('clock-time')).toBeVisible();
	await expect(strip(page)).toHaveCount(0);
});
