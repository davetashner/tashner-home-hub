/** Pure display logic for the home sports strip: which card state, and its labels (hub-5tk.2). */
import {
	finalVisible,
	nextGames,
	resultOf,
	type Game,
	type SportsTeam
} from '#lib/domain/sports.js';

export type CardState = 'normal' | 'today' | 'live' | 'final';

export interface StripCard {
	/** Stable render key: the team id. */
	key: string;
	teamId: string;
	abbr: string;
	state: CardState;
	/** Game-day and live cards are big. */
	big: boolean;
	/** "Today", "Live · Q3 8:42", or null. */
	eyebrow: string | null;
	title: string;
	/** Second line, or null. */
	sub: string | null;
	/** Game-day only. */
	countdown: { value: string; unit: string } | null;
	/** Live only: team score first. */
	score: { team: number; opponent: number } | null;
	/** Final only. */
	result: 'W' | 'L' | 'T' | null;
}

const DAY_MS = 86_400_000;
const TWO_WORD_NICKNAMES = new Set(['Blue', 'Red', 'Maple', 'Golden', 'Hockey']);

/** "Pittsburgh Steelers" becomes "Steelers"; "Columbus Blue Jackets" becomes "Blue Jackets". */
export function shortName(full: string): string {
	const words = full.trim().split(/\s+/);
	if (words.length < 2) return words[0] ?? '';
	const two = words[words.length - 2];
	return TWO_WORD_NICKNAMES.has(two) ? words.slice(-2).join(' ') : words[words.length - 1];
}

const localDay = (ms: number, timeZone: string): number => {
	const p = Object.fromEntries(
		new Intl.DateTimeFormat('en-US', {
			timeZone,
			year: 'numeric',
			month: 'numeric',
			day: 'numeric'
		})
			.formatToParts(ms)
			.map((x) => [x.type, Number(x.value)])
	);
	return Date.UTC(p.year, p.month - 1, p.day) / DAY_MS;
};

const localHour = (ms: number, timeZone: string): number =>
	Number(
		new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', hour: 'numeric' }).format(ms)
	);

/** Whole local calendar days from `now` to `ms` (0 = today). */
export const daysAway = (ms: number, now: number, timeZone: string): number =>
	localDay(ms, timeZone) - localDay(now, timeZone);

export const clockTime = (ms: number, timeZone: string): string =>
	new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(ms);

/** "Sun" within the week, "Nov 15" beyond it. */
function farDay(ms: number, now: number, timeZone: string): string {
	const away = daysAway(ms, now, timeZone);
	if (away < 7) return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(ms);
	return new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric' }).format(ms);
}

/** "Today" or "Tonight" (from 5 PM), "Tomorrow", then the weekday or date. */
export function dayWord(ms: number, now: number, timeZone: string, tonight = true): string {
	const away = daysAway(ms, now, timeZone);
	if (away <= 0) return tonight && localHour(ms, timeZone) >= 17 ? 'Tonight' : 'Today';
	if (away === 1) return 'Tomorrow';
	return farDay(ms, now, timeZone);
}

const vsAt = (g: Game): string => (g.home ? 'vs' : 'at');

/** "2h 15m", "45m"; null once the start has passed. */
export function countdownText(startMs: number, now: number): string | null {
	const mins = Math.ceil((startMs - now) / 60_000);
	if (mins <= 0) return null;
	const h = Math.floor(mins / 60);
	return h > 0 ? `${h}h ${String(mins % 60).padStart(2, '0')}m` : `${mins}m`;
}

function nextFor(games: readonly Game[], team: SportsTeam, now: number): Game | null {
	return nextGames(games, [team], now)[0] ?? null;
}

function finalLine(team: SportsTeam, g: Game): string {
	const mine = `${team.name} ${g.teamScore}`;
	const theirs = `${shortName(g.opponent.name)} ${g.opponentScore}`;
	const lost = (g.teamScore ?? 0) < (g.opponentScore ?? 0);
	return `Final: ${lost ? `${theirs}, ${mine}` : `${mine}, ${theirs}`}`;
}

function cardFor(
	team: SportsTeam,
	games: readonly Game[],
	now: number,
	timeZone: string
): StripCard | null {
	const mine = games.filter((g) => g.team === team.id);
	const base = { key: team.id, teamId: team.id, abbr: team.abbr };
	const none = { countdown: null, score: null, result: null, eyebrow: null };

	const live = mine.find((g) => g.status === 'live');
	if (live) {
		const status = [live.period, live.clock].filter(Boolean).join(' ');
		return {
			...base,
			...none,
			state: 'live',
			big: true,
			eyebrow: status ? `Live · ${status}` : 'Live',
			title: `${team.name} ${vsAt(live)} ${shortName(live.opponent.name)}`,
			sub: live.channel,
			score:
				live.teamScore === null || live.opponentScore === null
					? null
					: { team: live.teamScore, opponent: live.opponentScore }
		};
	}

	const done = mine
		.filter((g) => resultOf(g) !== null && finalVisible(g, now, timeZone))
		.sort((a, b) => b.start.localeCompare(a.start))[0];
	if (done) {
		const next = nextFor(games, team, now);
		return {
			...base,
			...none,
			state: 'final',
			big: false,
			title: finalLine(team, done),
			sub: next
				? `Next: ${dayWord(Date.parse(next.start), now, timeZone, false)} ${vsAt(next)} ${shortName(next.opponent.name)}`
				: null,
			result: resultOf(done)
		};
	}

	const next = nextFor(games, team, now);
	if (!next) return null;
	const start = Date.parse(next.start);
	const title = `${team.name} ${vsAt(next)} ${shortName(next.opponent.name)}`;
	const when = [clockTime(start, timeZone), next.channel].filter(Boolean).join(' · ');
	if (daysAway(start, now, timeZone) === 0) {
		const left = countdownText(start, now);
		const unit = team.league === 'nhl' ? 'to puck drop' : 'to kickoff';
		return {
			...base,
			...none,
			state: 'today',
			big: true,
			eyebrow: 'Today',
			title,
			sub: when,
			countdown: left ? { value: left, unit } : { value: 'Starting', unit: 'now' }
		};
	}
	return {
		...base,
		...none,
		state: 'normal',
		big: false,
		title,
		sub: `${dayWord(start, now, timeZone)} ${when}`
	};
}

/** The strip's cards: live and game-day first, otherwise in the order of `teams`. Empty hides the strip. */
export function stripCards(
	games: readonly Game[],
	teams: readonly SportsTeam[],
	now: number,
	timeZone: string
): StripCard[] {
	const cards = teams
		.map((t) => cardFor(t, games, now, timeZone))
		.filter((c): c is StripCard => c !== null);
	return [...cards.filter((c) => c.big), ...cards.filter((c) => !c.big)];
}
