import { describe, expect, it } from 'vitest';
import {
	DEFAULT_TEAMS,
	FAST_POLL_MS,
	SLOW_POLL_MS,
	finalVisible,
	inWindow,
	liveGames,
	mergeGames,
	nextGames,
	parseEspn,
	parseTeams,
	pollInterval,
	resultOf,
	scheduleUrl,
	scoreboardUrl,
	sixAmAfter,
	type Game
} from './sports.js';

const [RAVENS, CMD, CAPS] = DEFAULT_TEAMS;

function side(abbr: string, name: string, homeAway: string, score?: unknown) {
	return { homeAway, team: { abbreviation: abbr, displayName: name }, score };
}
function event(over: {
	id?: string;
	date?: string;
	state?: string;
	name?: string;
	period?: number;
	clock?: string;
	broadcasts?: unknown[];
	competitors?: unknown[];
}) {
	return {
		id: over.id ?? '1',
		competitions: [
			{
				date: over.date ?? '2026-11-08T18:00Z',
				competitors: over.competitors ?? [
					side('BAL', 'Baltimore Ravens', 'home', { displayValue: '24' }),
					side('CIN', 'Cincinnati Bengals', 'away', { displayValue: '17' })
				],
				broadcasts: over.broadcasts ?? [
					{ type: { shortName: 'TV' }, market: { type: 'National' }, media: { shortName: 'CBS' } }
				],
				status: {
					period: over.period ?? 0,
					displayClock: over.clock ?? '0:00',
					type: { name: over.name ?? 'STATUS_SCHEDULED', state: over.state ?? 'pre' }
				}
			}
		]
	};
}
const wrap = (...events: unknown[]) => ({ events });

describe('parseEspn', () => {
	it('parses a scheduled game with channel and no score', () => {
		const [g] = parseEspn(wrap(event({})), [RAVENS]);
		expect(g).toEqual({
			id: '1',
			league: 'nfl',
			team: 'nfl:bal',
			opponent: { name: 'Cincinnati Bengals', abbr: 'CIN' },
			home: true,
			start: '2026-11-08T18:00:00.000Z',
			status: 'scheduled',
			teamScore: null,
			opponentScore: null,
			period: null,
			clock: null,
			channel: 'CBS'
		});
	});

	it('parses a live NFL game from scoreboard string scores', () => {
		const e = event({
			state: 'in',
			name: 'STATUS_IN_PROGRESS',
			period: 3,
			clock: '9:55',
			competitors: [
				side('CIN', 'Cincinnati Bengals', 'home', '7'),
				side('BAL', 'Ravens', 'away', '10')
			],
			broadcasts: [{ names: ['Fox'] }]
		});
		const [g] = parseEspn(wrap(e), [RAVENS]);
		expect(g).toMatchObject({
			status: 'live',
			home: false,
			teamScore: 10,
			opponentScore: 7,
			period: 'Q3',
			clock: '9:55',
			channel: 'Fox'
		});
	});

	it('names hockey periods, overtime and shootout, and halftime', () => {
		const live = (period: number, name = 'STATUS_IN_PROGRESS') =>
			parseEspn(wrap(event({ state: 'in', name, period, clock: '1:00' })), [
				{ ...CAPS, abbr: 'BAL' }
			])[0];
		expect(live(1).period).toBe('1st');
		expect(live(3).period).toBe('3rd');
		expect(live(4).period).toBe('OT');
		expect(live(5).period).toBe('SO');
		expect(live(0).period).toBeNull();
		const half = parseEspn(wrap(event({ state: 'in', name: 'STATUS_HALFTIME', period: 2 })), [
			RAVENS
		])[0];
		expect(half).toMatchObject({ period: 'Half', clock: null });
		const ot = parseEspn(wrap(event({ state: 'in', period: 5 })), [RAVENS])[0];
		expect(ot.period).toBe('OT');
	});

	it('parses a final and computes the result', () => {
		const [g] = parseEspn(wrap(event({ state: 'post', name: 'STATUS_FINAL', period: 4 })), [
			RAVENS
		]);
		expect(g).toMatchObject({ status: 'final', teamScore: 24, opponentScore: 17 });
		expect(resultOf(g)).toBe('W');
		expect(resultOf({ ...g, teamScore: 3 })).toBe('L');
		expect(resultOf({ ...g, teamScore: 17 })).toBe('T');
		expect(resultOf({ ...g, teamScore: null })).toBeNull();
		expect(resultOf({ ...g, status: 'live' })).toBeNull();
	});

	it('maps postponed and cancelled games', () => {
		for (const name of ['STATUS_POSTPONED', 'STATUS_CANCELED']) {
			const [g] = parseEspn(wrap(event({ state: 'post', name })), [RAVENS]);
			expect(g.status).toBe('postponed');
			expect(g.teamScore).toBeNull();
		}
	});

	it('picks the national TV channel, ignores streaming, and tolerates none', () => {
		const pick = (b: unknown[]) => parseEspn(wrap(event({ broadcasts: b })), [RAVENS])[0].channel;
		expect(
			pick([
				{ type: { shortName: 'Streaming' }, media: { shortName: 'ESPN+' } },
				{ type: { shortName: 'TV' }, market: { type: 'Home' }, media: { shortName: 'LOCAL' } },
				{ type: { shortName: 'TV' }, market: { type: 'National' }, media: { shortName: 'ABC' } }
			])
		).toBe('ABC');
		expect(pick([{ type: { shortName: 'Streaming' }, media: { shortName: 'ESPN+' } }])).toBeNull();
		expect(pick([null, { media: {} }, { names: [] }])).toBeNull();
		expect(pick([{ type: { shortName: 'TV' }, media: { shortName: 'MNMT' } }])).toBe('MNMT');
	});

	it('yields a game for each followed team in one event', () => {
		const e = event({
			competitors: [
				side('BAL', 'Baltimore Ravens', 'home'),
				side('WSH', 'Washington Commanders', 'away')
			]
		});
		const games = parseEspn(wrap(e), [RAVENS, CMD]);
		expect(games.map((g) => [g.team, g.home, g.opponent.abbr])).toEqual([
			['nfl:bal', true, 'WSH'],
			['nfl:wsh', false, 'BAL']
		]);
	});

	it('skips events not involving a followed team', () => {
		const e = event({
			competitors: [side('DAL', 'Dallas', 'home'), side('NYG', 'Giants', 'away')]
		});
		expect(parseEspn(wrap(e), [RAVENS])).toEqual([]);
	});

	it('never throws on malformed input', () => {
		const bad = [
			null,
			undefined,
			42,
			'x',
			[],
			{},
			{ events: 'no' },
			{ events: [null, 7, {}, { id: '1' }, { id: '1', competitions: [] }] },
			{ events: [{ id: '1', competitions: [null] }] },
			{ events: [event({ date: 'garbage' })] },
			{ events: [{ ...event({}), id: '' }] },
			{ events: [event({ state: 'weird' })] },
			{ events: [event({ competitors: [side('BAL', 'x', 'home')] })] },
			{
				events: [event({ competitors: [side('BAL', 'x', 'home'), { homeAway: 'away', team: {} }] })]
			},
			{ events: [event({ competitors: [side('BAL', 'x', 'home'), null] })] }
		];
		for (const raw of bad) expect(parseEspn(raw, [RAVENS])).toEqual([]);
		const noType = event({});
		(noType.competitions[0] as { status: unknown }).status = null;
		expect(parseEspn(wrap(noType), [RAVENS])).toEqual([]);
	});

	it('keeps a good event next to a bad one and null for junk scores', () => {
		const junk = event({
			id: '2',
			state: 'in',
			name: 'STATUS_IN_PROGRESS',
			competitors: [
				side('BAL', 'Ravens', 'home', 'abc'),
				side('CIN', 'Bengals', 'away', { value: 3 })
			]
		});
		const games = parseEspn(wrap(null, junk), [RAVENS]);
		expect(games).toHaveLength(1);
		expect(games[0]).toMatchObject({ teamScore: null, opponentScore: 3 });
	});
});

describe('parseTeams', () => {
	it('validates, normalises, dedupes and caps', () => {
		expect(
			parseTeams([
				{ league: 'nhl', abbr: 'wsh', name: 'Capitals' },
				{ league: 'nhl', abbr: 'WSH' },
				{ league: 'nba', abbr: 'LAL' },
				{ league: 'nfl', abbr: 'B1' },
				{ league: 'nfl' },
				'x',
				{ league: 'nfl', abbr: 'bal' }
			])
		).toEqual([
			{ id: 'nhl:wsh', league: 'nhl', abbr: 'WSH', name: 'Capitals' },
			{ id: 'nfl:bal', league: 'nfl', abbr: 'BAL', name: 'BAL' }
		]);
		const many = Array.from({ length: 12 }, (_, i) => ({
			league: 'nfl',
			abbr: `T${String.fromCharCode(65 + i)}`.replace(/[^A-Z]/g, 'X') + 'Q'
		}));
		expect(parseTeams(many)).toHaveLength(8);
	});

	it('is null for nothing usable', () => {
		expect(parseTeams(null)).toBeNull();
		expect(parseTeams({})).toBeNull();
		expect(parseTeams([])).toBeNull();
		expect(parseTeams([{ league: 'mlb', abbr: 'BOS' }])).toBeNull();
	});
});

it('builds ESPN urls', () => {
	expect(scheduleUrl(CAPS)).toBe(
		'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams/wsh/schedule'
	);
	expect(scoreboardUrl('nfl')).toBe(
		'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard'
	);
});

const NOW = Date.parse('2026-11-08T12:00:00Z');
const game = (over: Partial<Game>): Game => ({
	id: '1',
	league: 'nfl',
	team: 'nfl:bal',
	opponent: { name: 'Bengals', abbr: 'CIN' },
	home: true,
	start: '2026-11-08T18:00:00.000Z',
	status: 'scheduled',
	teamScore: null,
	opponentScore: null,
	period: null,
	clock: null,
	channel: null,
	...over
});
const hours = (h: number) => new Date(NOW + h * 3_600_000).toISOString();

describe('lists', () => {
	it('merges by team and event, fresh wins, sorted by start', () => {
		const a = game({ id: 'a', start: hours(5) });
		const b = game({ id: 'b', start: hours(1) });
		const live = game({ id: 'a', start: hours(5), status: 'live' });
		const other = game({ id: 'a', team: 'nfl:wsh', start: hours(5) });
		const out = mergeGames([a, b, other], [live]);
		expect(out.map((g) => [g.id, g.team, g.status])).toEqual([
			['b', 'nfl:bal', 'scheduled'],
			['a', 'nfl:bal', 'live'],
			['a', 'nfl:wsh', 'scheduled']
		]);
	});

	it('windows from yesterday to 14 days out', () => {
		const games = [
			game({ id: 'old', start: hours(-40) }),
			game({ id: 'yday', start: hours(-20) }),
			game({ id: 'soon', start: hours(24 * 13) }),
			game({ id: 'far', start: hours(24 * 15) })
		];
		expect(inWindow(games, NOW).map((g) => g.id)).toEqual(['yday', 'soon']);
		expect(inWindow(games, NOW, 30).map((g) => g.id)).toEqual(['yday', 'soon', 'far']);
	});

	it('finds live games', () => {
		expect(liveGames([game({}), game({ id: '2', status: 'live' })]).map((g) => g.id)).toEqual([
			'2'
		]);
	});

	it('picks each team next game within the horizon, live first', () => {
		const games = [
			game({ id: 'p', status: 'final', start: hours(-3) }),
			game({ id: 'n2', start: hours(24 * 7) }),
			game({ id: 'n1', start: hours(24 * 3) }),
			game({ id: 'x', team: 'nfl:wsh', start: hours(24 * 11) }),
			game({ id: 'l', team: 'nhl:wsh', league: 'nhl', status: 'live', start: hours(-1) }),
			game({ id: 'n3', team: 'nhl:wsh', league: 'nhl', start: hours(5) }),
			game({ id: 'pp', team: 'nfl:wsh', status: 'postponed', start: hours(2) })
		];
		expect(nextGames(games, DEFAULT_TEAMS, NOW).map((g) => g.id)).toEqual(['n1', 'l']);
		expect(nextGames(games, DEFAULT_TEAMS, NOW, 14).map((g) => g.id)).toEqual(['n1', 'x', 'l']);
		expect(nextGames([], DEFAULT_TEAMS, NOW)).toEqual([]);
	});
});

describe('finalVisible', () => {
	const tz = 'America/New_York';
	// Sunday 1 PM EST kickoff.
	const final = game({ status: 'final', start: '2026-11-08T18:00:00Z' });

	it('hides until 6 AM local the next morning', () => {
		const sixAm = Date.parse('2026-11-09T11:00:00Z'); // 06:00 EST
		expect(sixAmAfter(Date.parse(final.start), tz)).toBe(sixAm);
		expect(finalVisible(final, sixAm - 1, tz)).toBe(true);
		expect(finalVisible(final, sixAm, tz)).toBe(false);
		expect(finalVisible(final, Date.parse(final.start), tz)).toBe(true);
	});

	it('uses the local date of the start, across DST and zones', () => {
		// 8:20 PM EST Sunday is already Monday in UTC; the cutoff is still Monday 6 AM EST.
		const late = game({ status: 'final', start: '2026-11-09T01:20:00Z' });
		expect(sixAmAfter(Date.parse(late.start), tz)).toBe(Date.parse('2026-11-09T11:00:00Z'));
		// US fall-back happened on 2026-11-01: still EDT (UTC-4) the evening before.
		expect(sixAmAfter(Date.parse('2026-10-31T23:00:00Z'), tz)).toBe(
			Date.parse('2026-11-01T11:00:00Z')
		);
		expect(sixAmAfter(Date.parse('2026-11-08T18:00:00Z'), 'UTC')).toBe(
			Date.parse('2026-11-09T06:00:00Z')
		);
	});

	it('only applies to finals with a valid start', () => {
		expect(finalVisible(game({ status: 'live' }), NOW, tz)).toBe(false);
		expect(finalVisible(game({ status: 'final', start: 'nope' }), NOW, tz)).toBe(false);
	});
});

describe('pollInterval', () => {
	it('is fast while live or about to start, slow otherwise', () => {
		expect(pollInterval([], NOW)).toBe(SLOW_POLL_MS);
		expect(pollInterval([game({ status: 'live', start: hours(-1) })], NOW)).toBe(FAST_POLL_MS);
		const soon = new Date(NOW + 10 * 60_000).toISOString();
		expect(pollInterval([game({ start: soon })], NOW)).toBe(FAST_POLL_MS);
		const late = new Date(NOW - 10 * 60_000).toISOString();
		expect(pollInterval([game({ start: late })], NOW)).toBe(FAST_POLL_MS);
		const later = new Date(NOW + 20 * 60_000).toISOString();
		expect(pollInterval([game({ start: later })], NOW)).toBe(SLOW_POLL_MS);
		expect(pollInterval([game({ status: 'final', start: late })], NOW)).toBe(SLOW_POLL_MS);
		const stale = new Date(NOW - 2 * 3_600_000).toISOString();
		expect(pollInterval([game({ start: stale })], NOW)).toBe(SLOW_POLL_MS);
	});
});
