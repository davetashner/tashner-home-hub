/** Pure logic for the 14-day games sheet: day groups, row labels, calendar clashes (hub-5tk.3). */
import { resultOf, type Game, type SportsTeam } from '#lib/domain/sports.js';
import { clockTime, daysAway, opponentShort } from '#lib/domain/sports-strip.js';

/** The slice of a calendar event the clash check needs. */
export interface ClashEvent {
	title: string;
	startsAt: number;
	endsAt: number;
	allDay: boolean;
}

export interface SheetRow {
	key: string;
	teamId: string;
	abbr: string;
	state: Game['status'];
	/** "Ravens vs Steelers" (vs = home, at = away). */
	title: string;
	/** Scheduled: the start time. Null otherwise. */
	time: string | null;
	channel: string | null;
	/** Live: "Q3 8:42". */
	status: string | null;
	/** Live or final: team score first. */
	score: { team: number; opponent: number } | null;
	/** Final only. */
	result: 'W' | 'L' | 'T' | null;
	/** Final only: "Final 24–17 W". */
	outcome: string | null;
	/** Title of the calendar event that overlaps the game, or null. */
	clash: string | null;
}

export interface SheetDay {
	/** Local date, YYYY-MM-DD. */
	key: string;
	/** "Sunday, Nov 8". */
	label: string;
	rows: SheetRow[];
}

const HOUR = 3_600_000;
export const SHEET_DAYS = 14;

/** How long a game blocks the afternoon: 3 h of football, 2.5 h of hockey. */
export const gameLengthMs = (league: Game['league']): number =>
	league === 'nhl' ? 2.5 * HOUR : 3 * HOUR;

/** First timed event that intersects the game's playing time, or null. All-day events never clash. */
export function findClash(game: Game, events: readonly ClashEvent[]): string | null {
	const start = Date.parse(game.start);
	if (Number.isNaN(start)) return null;
	const end = start + gameLengthMs(game.league);
	const hit = events.find((e) => {
		if (e.allDay) return false;
		// An event with no length counts as the moment it starts.
		return e.endsAt <= e.startsAt
			? e.startsAt >= start && e.startsAt < end
			: e.startsAt < end && e.endsAt > start;
	});
	return hit ? hit.title : null;
}

const dayKey = (ms: number, timeZone: string): string =>
	new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(ms);

const dayLabel = (ms: number, timeZone: string): string =>
	new Intl.DateTimeFormat('en-US', {
		timeZone,
		weekday: 'long',
		month: 'short',
		day: 'numeric'
	}).format(ms);

function rowFor(
	game: Game,
	team: SportsTeam | undefined,
	timeZone: string,
	events: readonly ClashEvent[]
): SheetRow {
	const start = Date.parse(game.start);
	const result = resultOf(game);
	const hasScore = game.teamScore !== null && game.opponentScore !== null;
	const status = [game.period, game.clock].filter(Boolean).join(' ');
	return {
		key: `${game.team}:${game.id}`,
		teamId: game.team,
		abbr: team?.abbr ?? game.team.split(':')[1]?.toUpperCase() ?? '',
		state: game.status,
		title: `${team?.name ?? ''} ${game.home ? 'vs' : 'at'} ${opponentShort(game)}`.trim(),
		time: game.status === 'scheduled' ? clockTime(start, timeZone) : null,
		channel: game.channel,
		status: game.status === 'live' && status ? status : null,
		score:
			(game.status === 'live' || game.status === 'final') && hasScore
				? { team: game.teamScore as number, opponent: game.opponentScore as number }
				: null,
		result,
		outcome:
			game.status === 'final'
				? ['Final', hasScore ? `${game.teamScore}–${game.opponentScore}` : null, result]
						.filter(Boolean)
						.join(' ')
				: null,
		clash: game.status === 'scheduled' || game.status === 'live' ? findClash(game, events) : null
	};
}

/** Games from today through `days` ahead, grouped by local day, earliest first. */
export function sheetDays(
	games: readonly Game[],
	teams: readonly SportsTeam[],
	events: readonly ClashEvent[],
	now: number,
	timeZone: string,
	days = SHEET_DAYS
): SheetDay[] {
	const order = (g: Game) => teams.findIndex((t) => t.id === g.team);
	const wanted = games
		.map((g) => ({ g, t: Date.parse(g.start) }))
		.filter(
			({ t }) => !Number.isNaN(t) && daysAway(t, now, timeZone) >= 0 && t <= now + days * 24 * HOUR
		)
		.sort((a, b) => a.t - b.t || order(a.g) - order(b.g));
	const out: SheetDay[] = [];
	for (const { g, t } of wanted) {
		const key = dayKey(t, timeZone);
		let day = out[out.length - 1];
		if (day?.key !== key) {
			day = { key, label: dayLabel(t, timeZone), rows: [] };
			out.push(day);
		}
		day.rows.push(
			rowFor(
				g,
				teams.find((x) => x.id === g.team),
				timeZone,
				events
			)
		);
	}
	return out;
}
