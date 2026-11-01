import { expect, test, type Page } from '@playwright/test';
import { ensureHousehold } from './adult';
import { gotoHydrated } from './hydrated';

test.use({ serviceWorkers: 'block' });
test.beforeAll(ensureHousehold);

const NOW = Date.parse('2030-01-06T16:00:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
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

async function open(page: Page, games: unknown[], events: unknown[] = []) {
	await page.route('**/api/sports', (route) =>
		route.fulfill({ json: { teams: TEAMS, games, updatedAt: NOW } })
	);
	await page.route('**/api/calendar/events**', (route) => route.fulfill({ json: events }));
	await page.clock.setFixedTime(NOW);
	await gotoHydrated(page, '/');
}

const sheet = (page: Page) => page.getByTestId('sports-sheet');
const openSheet = async (page: Page) => {
	await page.getByTestId('sports-card').first().click();
	await expect(sheet(page)).toBeVisible();
};

test('tapping the strip lists two weeks of games by day, flags a clash @J0.2', async ({
	page
}, info) => {
	await open(
		page,
		[
			game('nfl:bal', { start: iso(2 * DAY) }),
			game('nfl:wsh', { start: iso(2 * DAY + HOUR), home: false, channel: 'FOX' }),
			game('nhl:wsh', { start: iso(5 * DAY), home: false, channel: 'MNMT' }),
			game('nfl:bal', { start: iso(30 * DAY) })
		],
		[
			{
				title: 'Grandma visit',
				startsAt: NOW + 2 * DAY + 30 * MIN,
				endsAt: NOW + 2 * DAY + 90 * MIN,
				allDay: false
			},
			{
				title: 'Birthday',
				startsAt: NOW + 2 * DAY - 6 * HOUR,
				endsAt: NOW + 2 * DAY + 20 * HOUR,
				allDay: true
			}
		]
	);
	await expect(page.getByTestId('sports-card').first()).toHaveAccessibleName(
		/Show games for the next two weeks/
	);
	await openSheet(page);
	await expect(sheet(page).getByRole('heading', { name: 'Games, next two weeks' })).toBeVisible();
	await expect(sheet(page).getByTestId('sports-day')).toHaveCount(2);
	await expect(sheet(page).getByTestId('sports-row')).toHaveCount(3);
	const rows = sheet(page).getByTestId('sports-row');
	await expect(rows.nth(0)).toContainText('Ravens vs Rockets');
	await expect(rows.nth(0)).toContainText('CBS');
	await expect(rows.nth(1)).toContainText('Commanders at Rockets');
	await expect(rows.nth(2)).toContainText('Capitals at Rockets');
	await expect(sheet(page).getByTestId('sports-clash')).toHaveCount(2);
	await expect(rows.nth(0).getByTestId('sports-clash')).toHaveText('Same time as Grandma visit');
	const close = sheet(page).getByRole('button', { name: 'Close', exact: true });
	expect((await close.boundingBox())!.height).toBeGreaterThanOrEqual(60);
	const dir = process.env.SPORTS_SHOTS;
	if (dir) {
		await page.waitForTimeout(600);
		const o = info.project.name.includes('portrait') ? 'portrait' : 'landscape';
		await page.screenshot({ path: `${dir}/sheet-${o}.png` });
	}
});

test('live and final rows show score instead of the time; Esc, Close and the backdrop close @J0.2', async ({
	page
}) => {
	await open(page, [
		game('nfl:bal', { start: iso(-5 * HOUR), status: 'final', teamScore: 24, opponentScore: 17 }),
		game('nfl:wsh', {
			start: iso(-HOUR),
			status: 'live',
			teamScore: 7,
			opponentScore: 3,
			period: 'Q2',
			clock: '4:10'
		}),
		game('nhl:wsh', { start: iso(5 * HOUR) })
	]);
	await openSheet(page);
	const rows = sheet(page).getByTestId('sports-row');
	await expect(rows.nth(0).getByTestId('sports-row-when')).toHaveText('Final 24–17 W');
	await expect(rows.nth(1).getByTestId('sports-row-when')).toHaveText('7–3');
	await expect(rows.nth(1)).toContainText('Q2 4:10');
	await expect(sheet(page).getByTestId('sports-clash')).toHaveCount(0);
	await page.keyboard.press('Escape');
	await expect(sheet(page)).toHaveCount(0);
	await openSheet(page);
	await sheet(page).getByRole('button', { name: 'Close', exact: true }).click();
	await expect(sheet(page)).toHaveCount(0);
	await openSheet(page);
	await page.getByRole('button', { name: 'Close games' }).click({ position: { x: 4, y: 4 } });
	await expect(sheet(page)).toHaveCount(0);
});
