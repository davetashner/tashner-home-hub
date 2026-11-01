import { eq } from 'drizzle-orm';
import { Cron } from 'croner';
import { getDb, type Db } from './db/index.js';
import { settings } from './db/schema.js';
import { publish } from './domain/events.js';
import {
	DEFAULT_TEAMS,
	inWindow,
	mergeGames,
	parseEspn,
	parseTeams,
	pollInterval,
	scheduleUrl,
	scoreboardUrl,
	type Game,
	type League,
	type SportsTeam
} from '#lib/domain/sports.js';

const TEAMS_KEY = 'sports.teams';
const CACHE_KEY = 'sports.cache';
const TIMEOUT_MS = 8000;
const SCHEDULE_TTL_MS = 60 * 60_000;
const SCHEDULE_RETRY_MS = 5 * 60_000;

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

interface Cache {
	updatedAt: number;
	/** When the (large) team schedules were last fetched; live polls only fetch scoreboards. */
	scheduleAt: number;
	teams: SportsTeam[];
	games: Game[];
}

export interface SportsView {
	teams: SportsTeam[];
	games: Game[];
	updatedAt: number | null;
}

function readJsonSetting(db: Db, key: string): unknown {
	const row = db.select().from(settings).where(eq(settings.key, key)).get();
	if (!row) return null;
	try {
		return JSON.parse(row.value);
	} catch {
		return null;
	}
}

function writeJsonSetting(db: Db, key: string, value: unknown): void {
	const json = JSON.stringify(value);
	db.insert(settings)
		.values({ key, value: json })
		.onConflictDoUpdate({ target: settings.key, set: { value: json, updatedAt: Date.now() } })
		.run();
}

/** The followed teams: the saved list, or the family defaults. */
export function readSportsTeams(db: Db): SportsTeam[] {
	return parseTeams(readJsonSetting(db, TEAMS_KEY)) ?? [...DEFAULT_TEAMS];
}

/** Saves the team list; null when nothing in it was valid. Warms the cache in the background. */
export function saveSportsTeams(db: Db, raw: unknown, doFetch: Fetch = fetch): SportsTeam[] | null {
	const teams = parseTeams(raw);
	if (!teams) return null;
	writeJsonSetting(db, TEAMS_KEY, teams);
	void refreshSports(db, doFetch).catch(() => undefined);
	return teams;
}

function readCache(db: Db): Cache | null {
	const raw = readJsonSetting(db, CACHE_KEY) as Partial<Cache> | null;
	if (!raw || !Array.isArray(raw.games) || !Array.isArray(raw.teams)) return null;
	return raw as Cache;
}

let warned = false;
function warnOnce(): void {
	if (warned) return;
	warned = true;
	console.warn('[sports] an ESPN fetch failed; keeping the last good data');
}

async function getJson(url: string, doFetch: Fetch): Promise<unknown> {
	const res = await doFetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
	if (!res.ok) throw new Error(`sports HTTP ${res.status}`);
	return res.json();
}

/**
 * Fetches ESPN and stores the result. Team schedules are refreshed hourly (or when the team list
 * changed); scoreboards on every call. Any failure keeps the previous data for that part.
 * Publishes `sports` only when the games actually changed. Resolves to true if they did.
 */
export async function refreshSports(
	db: Db,
	doFetch: Fetch = fetch,
	now = Date.now()
): Promise<boolean> {
	const teams = readSportsTeams(db);
	const prev = readCache(db);
	const ids = new Set(teams.map((t) => t.id));
	const kept = (prev?.games ?? []).filter((g) => ids.has(g.team));
	const sameTeams =
		!!prev && prev.teams.length === ids.size && prev.teams.every((t) => ids.has(t.id));
	const scheduleDue =
		!prev ||
		!sameTeams ||
		now - prev.scheduleAt >= (prev.games.length ? SCHEDULE_TTL_MS : SCHEDULE_RETRY_MS);

	let games = kept;
	let failed = false;
	if (scheduleDue) {
		for (const team of teams) {
			try {
				const fresh = parseEspn(await getJson(scheduleUrl(team), doFetch), [team]);
				games = [...games.filter((g) => g.team !== team.id), ...fresh];
			} catch {
				failed = true;
			}
		}
	}
	for (const league of [...new Set(teams.map((t) => t.league))] as League[]) {
		try {
			const own = teams.filter((t) => t.league === league);
			games = mergeGames(games, parseEspn(await getJson(scoreboardUrl(league), doFetch), own));
		} catch {
			failed = true;
		}
	}
	if (failed) warnOnce();
	else warned = false;

	games = mergeGames([], inWindow(games, now));
	const changed = JSON.stringify(games) !== JSON.stringify(kept);
	if (changed || scheduleDue) {
		const scheduleAt = scheduleDue ? now : (prev?.scheduleAt ?? now);
		writeJsonSetting(db, CACHE_KEY, { updatedAt: now, scheduleAt, teams, games } satisfies Cache);
	}
	if (changed) publish('sports');
	return changed;
}

let inflight: Promise<unknown> | null = null;

/**
 * What `GET /api/sports` serves. Never waits on the network: returns the cache at once, and only
 * when there is no cache at all does it start a background refresh.
 */
export function getSports(db: Db, doFetch: Fetch = fetch, now = Date.now()): SportsView {
	const teams = readSportsTeams(db);
	const cache = readCache(db);
	if (!cache && !inflight) {
		const p = refreshSports(db, doFetch, now)
			.catch(() => undefined)
			.finally(() => {
				if (inflight === p) inflight = null;
			});
		inflight = p;
	}
	const ids = new Set(teams.map((t) => t.id));
	return {
		teams,
		games: inWindow(cache?.games ?? [], now).filter((g) => ids.has(g.team)),
		updatedAt: cache?.updatedAt ?? null
	};
}

let lastRun = 0;

/** One scheduler tick: refreshes when the cadence for the current games says it is due. */
export async function sportsTick(
	db: Db,
	doFetch: Fetch = fetch,
	now = Date.now()
): Promise<boolean> {
	const cache = readCache(db);
	const interval = pollInterval(cache?.games ?? [], now);
	if (cache && now - lastRun < interval - 1000) return false;
	lastRun = now;
	await refreshSports(db, doFetch, now);
	return true;
}

/** Ticks every 15 s; the pure helper decides whether a fetch is due (45 s live, hourly otherwise). */
export function startSportsScheduler(env: NodeJS.ProcessEnv = process.env): Cron | undefined {
	if (env.HUB_SPORTS === 'off') return undefined;
	const tick = () => void sportsTick(getDb()).catch(() => undefined);
	return new Cron('*/15 * * * * *', { protect: true, catch: true }, tick);
}

/** Test hook: forget in-memory cadence state. */
export function resetSportsState(): void {
	lastRun = 0;
	warned = false;
	inflight = null;
}
