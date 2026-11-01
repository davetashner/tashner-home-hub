import { describe, expect, it } from 'vitest';
import { DEFAULT_TEAMS, type Game } from '#lib/domain/sports.js';
import { findClash, gameLengthMs, sheetDays, type ClashEvent } from '#lib/domain/sports-sheet.js';

const TZ = 'America/New_York';
const at = (iso: string) => Date.parse(iso);
// Sunday 2026-11-08, 10:45 AM Eastern
const NOW = at('2026-11-08T15:45:00Z');
const HOUR = 3_600_000;

const game = (over: Partial<Game> & Pick<Game, 'team' | 'start'>): Game => ({
	id: `${over.team}-${over.start}`,
	league: over.team.startsWith('nhl') ? 'nhl' : 'nfl',
	opponent: { name: 'Pittsburgh Steelers', abbr: 'PIT' },
	home: true,
	status: 'scheduled',
	teamScore: null,
	opponentScore: null,
	period: null,
	clock: null,
	channel: 'CBS',
	...over
});

const ev = (over: Partial<ClashEvent> & Pick<ClashEvent, 'startsAt'>): ClashEvent => ({
	title: 'Grandma visit',
	endsAt: over.startsAt + HOUR,
	allDay: false,
	...over
});

describe('findClash', () => {
	const g = game({ team: 'nfl:bal', start: '2026-11-08T18:00:00Z' });
	const start = at(g.start);

	it('uses 3 h for football and 2.5 h for hockey', () => {
		expect(gameLengthMs('nfl')).toBe(3 * HOUR);
		expect(gameLengthMs('nhl')).toBe(2.5 * HOUR);
	});
	it('flags an event inside the game', () => {
		expect(findClash(g, [ev({ startsAt: start + HOUR })])).toBe('Grandma visit');
	});
	it('flags an event that started earlier and runs into the game', () => {
		expect(findClash(g, [ev({ startsAt: start - HOUR / 2 })])).toBe('Grandma visit');
	});
	it('ignores events that end as the game starts or start as it ends', () => {
		expect(findClash(g, [ev({ startsAt: start - HOUR })])).toBeNull();
		expect(findClash(g, [ev({ startsAt: start + 3 * HOUR })])).toBeNull();
	});
	it('hockey ends sooner than football', () => {
		const nhl = game({ team: 'nhl:wsh', start: g.start });
		const late = ev({ startsAt: start + 2.75 * HOUR });
		expect(findClash(nhl, [late])).toBeNull();
		expect(findClash(g, [late])).toBe('Grandma visit');
	});
	it('ignores all-day events', () => {
		expect(
			findClash(g, [ev({ startsAt: start - 6 * HOUR, endsAt: start + 9 * HOUR, allDay: true })])
		).toBeNull();
	});
	it('treats a zero-length event as the moment it starts', () => {
		expect(findClash(g, [ev({ startsAt: start + HOUR, endsAt: start + HOUR })])).toBe(
			'Grandma visit'
		);
		expect(findClash(g, [ev({ startsAt: start - HOUR, endsAt: start - HOUR })])).toBeNull();
	});
	it('returns null for a bad start', () => {
		expect(findClash(game({ team: 'nfl:bal', start: 'nope' }), [ev({ startsAt: 0 })])).toBeNull();
	});
});

describe('sheetDays', () => {
	const days = (games: Game[], events: ClashEvent[] = []) =>
		sheetDays(games, DEFAULT_TEAMS, events, NOW, TZ);

	it('groups by local day in time order, with a long day label', () => {
		const out = days([
			game({ team: 'nhl:wsh', start: '2026-11-10T00:00:00Z', home: false, channel: 'MNMT' }),
			game({ team: 'nfl:wsh', start: '2026-11-08T21:25:00Z', home: false, channel: 'FOX' }),
			game({ team: 'nfl:bal', start: '2026-11-08T18:00:00Z' })
		]);
		expect(out.map((d) => d.label)).toEqual(['Sunday, Nov 8', 'Monday, Nov 9']);
		expect(out[0].rows.map((r) => r.title)).toEqual([
			'Ravens vs Steelers',
			'Commanders at Steelers'
		]);
		expect(out[0].rows[0]).toMatchObject({ abbr: 'BAL', time: '1:00 PM', channel: 'CBS' });
		// 00:00Z on the 10th is 7 PM on the 9th Eastern
		expect(out[1].rows[0]).toMatchObject({ abbr: 'WSH', time: '7:00 PM', teamId: 'nhl:wsh' });
	});

	it('keeps earlier games today but drops yesterday and beyond 14 days', () => {
		const out = days([
			game({ team: 'nfl:bal', start: '2026-11-07T18:00:00Z', status: 'final' }),
			game({
				team: 'nfl:bal',
				start: '2026-11-08T05:30:00Z',
				status: 'final',
				teamScore: 3,
				opponentScore: 3
			}),
			game({ team: 'nfl:bal', start: '2026-11-23T18:00:00Z' }),
			game({ team: 'nfl:bal', start: '2026-11-22T14:00:00Z' }),
			game({ team: 'nfl:bal', start: 'bad' })
		]);
		expect(out.flatMap((d) => d.rows).map((r) => r.state)).toEqual(['final', 'scheduled']);
		expect(out).toHaveLength(2);
	});

	it('shows a live score and period instead of the time', () => {
		const [d] = days([
			game({
				team: 'nfl:bal',
				start: '2026-11-08T15:00:00Z',
				status: 'live',
				teamScore: 17,
				opponentScore: 10,
				period: 'Q3',
				clock: '8:42'
			}),
			game({ team: 'nfl:wsh', start: '2026-11-08T15:30:00Z', status: 'live' })
		]);
		expect(d.rows[0]).toMatchObject({
			time: null,
			status: 'Q3 8:42',
			score: { team: 17, opponent: 10 }
		});
		expect(d.rows[1]).toMatchObject({ status: null, score: null });
	});

	it('shows a final with its result', () => {
		const [d] = days([
			game({
				team: 'nfl:bal',
				start: '2026-11-08T14:00:00Z',
				status: 'final',
				teamScore: 24,
				opponentScore: 17
			})
		]);
		expect(d.rows[0]).toMatchObject({
			time: null,
			score: { team: 24, opponent: 17 },
			result: 'W',
			clash: null
		});
	});

	it('flags a clash only on upcoming and live games', () => {
		const events = [ev({ startsAt: at('2026-11-08T18:30:00Z'), title: 'Dinner' })];
		const [d] = days(
			[
				game({ team: 'nfl:bal', start: '2026-11-08T18:00:00Z' }),
				game({
					team: 'nfl:wsh',
					start: '2026-11-08T18:00:00Z',
					status: 'final',
					teamScore: 1,
					opponentScore: 0
				})
			],
			events
		);
		expect(d.rows.map((r) => r.clash)).toEqual(['Dinner', null]);
	});

	it('a final without a score is just Final', () => {
		const [d] = days([game({ team: 'nfl:bal', start: '2026-11-08T14:00:00Z', status: 'final' })]);
		expect(d.rows[0].outcome).toBe('Final');
	});

	it('falls back for a team that is no longer followed; empty when no games', () => {
		const [d] = sheetDays(
			[game({ team: 'nfl:xyz', start: '2026-11-08T18:00:00Z' })],
			[],
			[],
			NOW,
			TZ
		);
		expect(d.rows[0]).toMatchObject({ abbr: 'XYZ', title: 'vs Steelers' });
		expect(days([])).toEqual([]);
	});
});
