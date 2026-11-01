import { describe, expect, it } from 'vitest';
import { DEFAULT_TEAMS, type Game } from '#lib/domain/sports.js';
import {
	clockTime,
	countdownText,
	dayWord,
	daysAway,
	shortName,
	stripCards
} from '#lib/domain/sports-strip.js';

const TZ = 'America/New_York';
const at = (iso: string) => Date.parse(iso);
// Sunday 2026-11-08, 10:45 AM Eastern
const NOW = at('2026-11-08T15:45:00Z');

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

describe('shortName', () => {
	it('keeps the nickname', () => {
		expect(shortName('Pittsburgh Steelers')).toBe('Steelers');
		expect(shortName('Columbus Blue Jackets')).toBe('Blue Jackets');
		expect(shortName('Utah Hockey Club')).toBe('Hockey Club');
		expect(shortName('Rangers')).toBe('Rangers');
		expect(shortName('')).toBe('');
	});
});

describe('day and time labels', () => {
	it('counts local calendar days', () => {
		expect(daysAway(at('2026-11-09T03:00:00Z'), NOW, TZ)).toBe(0);
		expect(daysAway(at('2026-11-09T06:00:00Z'), NOW, TZ)).toBe(1);
	});
	it('says Today, Tonight, Tomorrow, weekday, date', () => {
		expect(dayWord(at('2026-11-08T18:00:00Z'), NOW, TZ)).toBe('Today');
		expect(dayWord(at('2026-11-09T00:00:00Z'), NOW, TZ)).toBe('Tonight');
		expect(dayWord(at('2026-11-09T00:00:00Z'), NOW, TZ, false)).toBe('Today');
		expect(dayWord(at('2026-11-09T18:00:00Z'), NOW, TZ)).toBe('Tomorrow');
		expect(dayWord(at('2026-11-12T18:00:00Z'), NOW, TZ)).toBe('Thu');
		expect(dayWord(at('2026-11-17T18:00:00Z'), NOW, TZ)).toBe('Nov 17');
	});
	it('formats the clock time', () => {
		expect(clockTime(at('2026-11-08T18:00:00Z'), TZ)).toBe('1:00 PM');
	});
	it('formats the countdown', () => {
		expect(countdownText(NOW + 135 * 60_000, NOW)).toBe('2h 15m');
		expect(countdownText(NOW + 120 * 60_000, NOW)).toBe('2h 00m');
		expect(countdownText(NOW + 45 * 60_000, NOW)).toBe('45m');
		expect(countdownText(NOW - 1000, NOW)).toBeNull();
	});
});

describe('stripCards', () => {
	it('is empty with no games in range', () => {
		expect(stripCards([], DEFAULT_TEAMS, NOW, TZ)).toEqual([]);
		const far = game({ team: 'nfl:bal', start: '2026-12-25T18:00:00Z' });
		expect(stripCards([far], DEFAULT_TEAMS, NOW, TZ)).toEqual([]);
	});

	it('shows a normal card per team and drops teams without a game', () => {
		const cards = stripCards(
			[
				game({ team: 'nfl:bal', start: '2026-11-12T01:15:00Z', channel: 'Prime Video' }),
				game({
					team: 'nhl:wsh',
					start: '2026-11-11T00:00:00Z',
					home: false,
					channel: null,
					opponent: { name: 'Boston Bruins', abbr: 'BOS' }
				})
			],
			DEFAULT_TEAMS,
			NOW,
			TZ
		);
		expect(cards.map((c) => [c.teamId, c.state, c.big])).toEqual([
			['nfl:bal', 'normal', false],
			['nhl:wsh', 'normal', false]
		]);
		expect(cards[0].title).toBe('Ravens vs Steelers');
		expect(cards[0].sub).toBe('Wed 8:15 PM · Prime Video');
		expect(cards[1].title).toBe('Capitals at Bruins');
		expect(cards[1].sub).toBe('Tue 7:00 PM');
	});

	it('makes a game-day card with a kickoff countdown and puts it first', () => {
		const cards = stripCards(
			[
				game({ team: 'nfl:bal', start: '2026-11-12T01:15:00Z' }),
				game({ team: 'nfl:wsh', start: '2026-11-08T18:00:00Z' }),
				game({ team: 'nhl:wsh', start: '2026-11-09T00:00:00Z' })
			],
			DEFAULT_TEAMS,
			NOW,
			TZ
		);
		expect(cards.map((c) => c.teamId)).toEqual(['nfl:wsh', 'nhl:wsh', 'nfl:bal']);
		expect(cards[0]).toMatchObject({
			state: 'today',
			big: true,
			eyebrow: 'Today',
			sub: '1:00 PM · CBS',
			countdown: { value: '2h 15m', unit: 'to kickoff' }
		});
		expect(cards[1]).toMatchObject({ state: 'today', sub: '7:00 PM · CBS' });
	});

	it('counts down to puck drop and handles a late start', () => {
		const [card] = stripCards(
			[game({ team: 'nhl:wsh', start: '2026-11-08T15:30:00Z', channel: null })],
			DEFAULT_TEAMS,
			NOW,
			TZ
		);
		expect(card.countdown).toEqual({ value: 'Starting', unit: 'now' });
		const [soon] = stripCards(
			[game({ team: 'nhl:wsh', start: '2026-11-08T16:30:00Z', channel: null })],
			DEFAULT_TEAMS,
			NOW,
			TZ
		);
		expect(soon.countdown).toEqual({ value: '45m', unit: 'to puck drop' });
		expect(soon.sub).toBe('11:30 AM');
	});

	it('shows a live card with period, clock and score', () => {
		const [card] = stripCards(
			[
				game({
					team: 'nfl:bal',
					start: '2026-11-08T15:00:00Z',
					status: 'live',
					teamScore: 17,
					opponentScore: 10,
					period: 'Q3',
					clock: '8:42'
				})
			],
			DEFAULT_TEAMS,
			NOW,
			TZ
		);
		expect(card).toMatchObject({
			state: 'live',
			big: true,
			eyebrow: 'Live · Q3 8:42',
			title: 'Ravens vs Steelers',
			sub: 'CBS',
			score: { team: 17, opponent: 10 }
		});
	});

	it('copes with a live game missing score and clock', () => {
		const [card] = stripCards(
			[game({ team: 'nfl:bal', start: '2026-11-08T15:00:00Z', status: 'live', channel: null })],
			DEFAULT_TEAMS,
			NOW,
			TZ
		);
		expect(card).toMatchObject({ eyebrow: 'Live', score: null, sub: null });
	});

	it('shows a final with W and the next game, winner first', () => {
		const night = at('2026-11-09T02:00:00Z'); // 9 PM Eastern, game done
		const cards = stripCards(
			[
				game({
					team: 'nfl:bal',
					start: '2026-11-08T18:00:00Z',
					status: 'final',
					teamScore: 24,
					opponentScore: 17
				}),
				game({
					team: 'nfl:bal',
					start: '2026-11-13T01:15:00Z',
					home: false,
					opponent: { name: 'Cincinnati Bengals', abbr: 'CIN' }
				}),
				game({
					team: 'nfl:wsh',
					start: '2026-11-08T18:00:00Z',
					status: 'final',
					teamScore: 16,
					opponentScore: 20,
					opponent: { name: 'New York Giants', abbr: 'NYG' }
				}),
				game({
					team: 'nhl:wsh',
					start: '2026-11-08T18:00:00Z',
					status: 'final',
					teamScore: 2,
					opponentScore: 2
				})
			],
			DEFAULT_TEAMS,
			night,
			TZ
		);
		expect(cards[0]).toMatchObject({
			state: 'final',
			big: false,
			title: 'Final: Ravens 24, Steelers 17',
			sub: 'Next: Thu at Bengals',
			result: 'W'
		});
		expect(cards[1]).toMatchObject({
			title: 'Final: Giants 20, Commanders 16',
			sub: null,
			result: 'L'
		});
		expect(cards[2].result).toBe('T');
	});

	it('drops a final after 6 AM next day and shows the next game', () => {
		const morning = at('2026-11-09T11:30:00Z'); // 6:30 AM Eastern
		const cards = stripCards(
			[
				game({
					team: 'nfl:bal',
					start: '2026-11-08T18:00:00Z',
					status: 'final',
					teamScore: 24,
					opponentScore: 17
				}),
				game({ team: 'nfl:bal', start: '2026-11-13T01:15:00Z' })
			],
			DEFAULT_TEAMS,
			morning,
			TZ
		);
		expect(cards[0].state).toBe('normal');
	});

	it('ignores a final without scores', () => {
		const cards = stripCards(
			[game({ team: 'nfl:bal', start: '2026-11-08T14:00:00Z', status: 'final' })],
			DEFAULT_TEAMS,
			NOW,
			TZ
		);
		expect(cards).toEqual([]);
	});
});
