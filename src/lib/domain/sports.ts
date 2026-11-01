/** Pure sports helpers: ESPN parsing, next game, live/final visibility, poll cadence (hub-5tk). */

export type League = 'nfl' | 'nhl';
export type GameStatus = 'scheduled' | 'live' | 'final' | 'postponed';

export interface SportsTeam {
	/** `${league}:${abbr}` in lower case. */
	id: string;
	league: League;
	/** ESPN abbreviation, upper case (BAL, WSH). */
	abbr: string;
	name: string;
}

export interface Game {
	/** ESPN event id. Unique per team: two followed teams can meet in one event. */
	id: string;
	league: League;
	/** The followed team's id (SportsTeam.id). */
	team: string;
	/** `short` is ESPN's shortDisplayName ("Blue Jackets"); caches from before it existed lack it. */
	opponent: { name: string; abbr: string; short?: string };
	home: boolean;
	/** Start time, ISO 8601 UTC. */
	start: string;
	status: GameStatus;
	teamScore: number | null;
	opponentScore: number | null;
	/** Live only: "Q3", "2nd", "OT", "Half". */
	period: string | null;
	/** Live only: the game clock, "9:55". */
	clock: string | null;
	/** TV channel, e.g. "CBS". */
	channel: string | null;
}

export const DEFAULT_TEAMS: readonly SportsTeam[] = [
	{ id: 'nfl:bal', league: 'nfl', abbr: 'BAL', name: 'Ravens' },
	{ id: 'nfl:wsh', league: 'nfl', abbr: 'WSH', name: 'Commanders' },
	{ id: 'nhl:wsh', league: 'nhl', abbr: 'WSH', name: 'Capitals' }
];

export const MAX_TEAMS = 8;
export const FAST_POLL_MS = 45_000;
export const SLOW_POLL_MS = 60 * 60_000;
export const SOON_MS = 15 * 60_000;
const LATE_START_MS = 30 * 60_000;
const DAY_MS = 86_400_000;

const LEAGUE_PATH: Record<League, string> = {
	nfl: 'football/nfl',
	nhl: 'hockey/nhl'
};

const isObj = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Validates the `sports.teams` setting. Bad entries are dropped; null when nothing usable. */
export function parseTeams(raw: unknown): SportsTeam[] | null {
	if (!Array.isArray(raw)) return null;
	const out: SportsTeam[] = [];
	for (const item of raw) {
		if (!isObj(item)) continue;
		const league = item.league;
		const abbr = text(item.abbr)?.toUpperCase();
		if ((league !== 'nfl' && league !== 'nhl') || !abbr || !/^[A-Z]{2,5}$/.test(abbr)) continue;
		const id = `${league}:${abbr.toLowerCase()}`;
		if (out.some((t) => t.id === id)) continue;
		out.push({ id, league, abbr, name: text(item.name)?.slice(0, 40) ?? abbr });
		if (out.length === MAX_TEAMS) break;
	}
	return out.length ? out : null;
}

export const scheduleUrl = (t: SportsTeam): string =>
	`https://site.api.espn.com/apis/site/v2/sports/${LEAGUE_PATH[t.league]}/teams/${t.abbr.toLowerCase()}/schedule`;

export const scoreboardUrl = (league: League): string =>
	`https://site.api.espn.com/apis/site/v2/sports/${LEAGUE_PATH[league]}/scoreboard`;

function statusOf(type: Record<string, unknown>): GameStatus | null {
	const name = String(type.name ?? '');
	if (/POSTPONED|CANCEL|SUSPENDED/.test(name)) return 'postponed';
	switch (type.state) {
		case 'pre':
			return 'scheduled';
		case 'in':
			return 'live';
		case 'post':
			return 'final';
		default:
			return null;
	}
}

function scoreOf(v: unknown): number | null {
	const raw = isObj(v) ? (v.displayValue ?? v.value) : v;
	const n = typeof raw === 'string' && raw.trim() ? Number(raw) : raw;
	return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

const ORDINAL = ['', '1st', '2nd', '3rd'];

function periodText(league: League, period: number, typeName: string): string | null {
	if (typeName === 'STATUS_HALFTIME') return 'Half';
	if (!Number.isInteger(period) || period < 1) return null;
	if (league === 'nfl') return period <= 4 ? `Q${period}` : 'OT';
	if (period <= 3) return ORDINAL[period];
	return period === 4 ? 'OT' : 'SO';
}

function channelOf(broadcasts: unknown[]): string | null {
	const names: { name: string; national: boolean; tv: boolean }[] = [];
	for (const b of broadcasts) {
		if (!isObj(b)) continue;
		const media = isObj(b.media) ? text(b.media.shortName) : null;
		const name = media ?? (Array.isArray(b.names) ? text(b.names[0]) : null);
		if (!name) continue;
		const market = isObj(b.market) ? b.market.type : null;
		const kind = isObj(b.type) ? b.type.shortName : null;
		names.push({ name, national: market === 'National', tv: !kind || kind === 'TV' });
	}
	const tv = names.filter((n) => n.tv);
	return (tv.find((n) => n.national) ?? tv[0])?.name ?? null;
}

function parseEvent(raw: unknown, teams: readonly SportsTeam[]): Game[] {
	if (!isObj(raw)) return [];
	const comp = arr(raw.competitions).find(isObj);
	const id = text(raw.id);
	const start = text(comp?.date ?? raw.date);
	if (!comp || !id || !start || Number.isNaN(Date.parse(start))) return [];
	const status = isObj(comp.status) ? comp.status : {};
	const type = isObj(status.type) ? status.type : null;
	const state = type ? statusOf(type) : null;
	if (!type || !state) return [];
	const sides = arr(comp.competitors).filter(isObj);
	if (sides.length !== 2) return [];
	const games: Game[] = [];
	for (const team of teams) {
		const me = sides.find((s) => isObj(s.team) && s.team.abbreviation === team.abbr);
		const them = sides.find((s) => s !== me);
		if (!me || !them) continue;
		const opp = isObj(them.team) ? them.team : {};
		const oppAbbr = text(opp.abbreviation);
		const oppName = text(opp.displayName) ?? text(opp.name) ?? oppAbbr;
		const oppShort = text(opp.shortDisplayName) ?? text(opp.nickname);
		if (!oppAbbr || !oppName) continue;
		const live = state === 'live';
		const hasScore = state === 'live' || state === 'final';
		games.push({
			id,
			league: team.league,
			team: team.id,
			opponent: oppShort
				? { name: oppName, abbr: oppAbbr, short: oppShort }
				: { name: oppName, abbr: oppAbbr },
			home: me.homeAway === 'home',
			start: new Date(start).toISOString(),
			status: state,
			teamScore: hasScore ? scoreOf(me.score) : null,
			opponentScore: hasScore ? scoreOf(them.score) : null,
			period: live ? periodText(team.league, Number(status.period), String(type.name)) : null,
			clock: live && type.name !== 'STATUS_HALFTIME' ? text(status.displayClock) : null,
			channel: channelOf(arr(comp.broadcasts))
		});
	}
	return games;
}

/**
 * Turns an ESPN team-schedule or scoreboard response into games for the given followed teams.
 * Both shapes carry `events[].competitions[0]`. Unknown shapes yield []; bad events are skipped.
 */
export function parseEspn(raw: unknown, teams: readonly SportsTeam[]): Game[] {
	if (!isObj(raw)) return [];
	return arr(raw.events).flatMap((e) => parseEvent(e, teams));
}

const gameKey = (g: Game): string => `${g.team}|${g.id}`;

/** Overlays fresher games (scoreboard) on a base list (schedule), keyed by team and event. */
export function mergeGames(base: readonly Game[], fresh: readonly Game[]): Game[] {
	const map = new Map<string, Game>();
	for (const g of [...base, ...fresh]) map.set(gameKey(g), g);
	return [...map.values()].sort(
		(a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id)
	);
}

/** Games worth keeping: from yesterday's finals up to `days` ahead. */
export function inWindow(games: readonly Game[], now: number, days = 14): Game[] {
	return games.filter((g) => {
		const t = Date.parse(g.start);
		return t >= now - 36 * 3_600_000 && t <= now + days * DAY_MS;
	});
}

export const liveGames = (games: readonly Game[]): Game[] =>
	games.filter((g) => g.status === 'live');

/** Each followed team's next game (live ones first) within `days`, in the order of `teams`. */
export function nextGames(
	games: readonly Game[],
	teams: readonly SportsTeam[],
	now: number,
	days = 10
): Game[] {
	const out: Game[] = [];
	for (const team of teams) {
		const mine = games.filter((g) => g.team === team.id);
		const live = mine.find((g) => g.status === 'live');
		const next = mine
			.filter((g) => {
				const t = Date.parse(g.start);
				return g.status === 'scheduled' && t >= now - LATE_START_MS && t <= now + days * DAY_MS;
			})
			.sort((a, b) => a.start.localeCompare(b.start))[0];
		const pick = live ?? next;
		if (pick) out.push(pick);
	}
	return out;
}

export const resultOf = (g: Game): 'W' | 'L' | 'T' | null => {
	if (g.status !== 'final' || g.teamScore === null || g.opponentScore === null) return null;
	return g.teamScore > g.opponentScore ? 'W' : g.teamScore < g.opponentScore ? 'L' : 'T';
};

function offsetMs(ms: number, timeZone: string): number {
	const p = Object.fromEntries(
		new Intl.DateTimeFormat('en-US', {
			timeZone,
			hourCycle: 'h23',
			year: 'numeric',
			month: 'numeric',
			day: 'numeric',
			hour: 'numeric',
			minute: 'numeric',
			second: 'numeric'
		})
			.formatToParts(ms)
			.map((x) => [x.type, Number(x.value)])
	);
	return (
		Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000
	);
}

/** The instant of 06:00 local time on the day after `ms`'s local date. */
export function sixAmAfter(ms: number, timeZone: string): number {
	const local = new Date(ms + offsetMs(ms, timeZone));
	const target = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1, 6);
	let guess = target - offsetMs(target, timeZone);
	guess = target - offsetMs(guess, timeZone);
	return guess;
}

/** A final stays on screen until 6 AM local the morning after the game's local start date. */
export function finalVisible(game: Game, now: number, timeZone: string): boolean {
	if (game.status !== 'final') return false;
	const start = Date.parse(game.start);
	return !Number.isNaN(start) && now < sixAmAfter(start, timeZone);
}

/** 45 s while a game is live or about to start, otherwise hourly. */
export function pollInterval(games: readonly Game[], now: number): number {
	const busy = games.some((g) => {
		if (g.status === 'live') return true;
		const until = Date.parse(g.start) - now;
		return g.status === 'scheduled' && until <= SOON_MS && until >= -LATE_START_MS;
	});
	return busy ? FAST_POLL_MS : SLOW_POLL_MS;
}
