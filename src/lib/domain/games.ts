/**
 * Games tab (hub-wzg): web games a grown-up adds at runtime. Only https pages are framed.
 * Pure validation and ordering; storage is `#lib/server/domain/games.js`.
 */
export const GAMES_SETTING_KEY = 'games.list';
export const MAX_GAMES = 24;
export const GAME_TITLE_MAX = 40;
export const GAME_URL_MAX = 2000;

/** Window event the player fires while a game is open so the wall's idle timers hold off. */
export const GAME_ACTIVE_EVENT = 'hub-game-active';
/** How often an open game reports activity. */
export const GAME_HEARTBEAT_MS = 30_000;
/** A game left open this long stops holding the idle timers (the frame may take over). */
export const GAME_HOLD_MAX_MS = 30 * 60_000;

export interface Game {
	id: string;
	title: string;
	url: string;
	image: string | null;
}

export type GameFields = Pick<Game, 'title' | 'url' | 'image'>;

/** The normalised https URL, or null for anything else (http:, javascript:, data:, relative...). */
export function cleanHttpsUrl(v: unknown): string | null {
	if (typeof v !== 'string') return null;
	const t = v.trim();
	if (t.length === 0 || t.length > GAME_URL_MAX) return null;
	try {
		const u = new URL(t);
		if (u.protocol !== 'https:' || !u.hostname || u.username || u.password) return null;
		return u.href;
	} catch {
		return null;
	}
}

function isPrivateIPv4(a: number, b: number): boolean {
	return (
		a === 10 ||
		a === 127 ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		(a === 169 && b === 254) ||
		(a === 100 && b >= 64 && b <= 127)
	);
}

/**
 * Whether a host is on the home network or this machine: loopback, RFC 1918, link-local,
 * carrier-grade NAT (100.64/10), IPv6 loopback / unique-local / link-local (bracketed or not),
 * `localhost` and `*.local`. Such a game is allowed, but the adult is warned.
 */
export function isPrivateHost(hostname: string): boolean {
	let h = hostname.trim().toLowerCase();
	if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
	if (h.endsWith('.')) h = h.slice(0, -1);
	if (!h) return false;
	if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
	const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
	if (v4) return isPrivateIPv4(Number(v4[1]), Number(v4[2]));
	if (!h.includes(':')) return false;
	if (h === '::1') return true;
	// IPv4-mapped (::ffff:a.b.c.d or the hex form the URL parser produces).
	const mappedDot = /^::ffff:(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(h);
	if (mappedDot) return isPrivateIPv4(Number(mappedDot[1]), Number(mappedDot[2]));
	const mappedHex = /^::ffff:([0-9a-f]{1,4}):[0-9a-f]{1,4}$/.exec(h);
	if (mappedHex) {
		const hi = parseInt(mappedHex[1]!, 16);
		return isPrivateIPv4(hi >> 8, hi & 0xff);
	}
	const first = parseInt(h.split(':')[0] || '0', 16);
	if (Number.isNaN(first)) return false;
	return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
}

/** Whether free-typed text is an https URL whose host is private (drives the Settings warning). */
export function isPrivateGameUrl(raw: string): boolean {
	const u = cleanHttpsUrl(raw);
	return u !== null && isPrivateHost(new URL(u).hostname);
}

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Whether a URL is on the hub's own origin. Such a page would run as the hub inside the frame
 * (with the kid's session, and able to lift its own sandbox), so it is never a game.
 */
export function isHubOrigin(url: string, hubOrigin: string | undefined): boolean {
	if (!hubOrigin) return false;
	try {
		return new URL(url).origin === new URL(hubOrigin).origin;
	} catch {
		return false;
	}
}

export function checkTitle(v: unknown): Checked<string> {
	const t = typeof v === 'string' ? v.trim() : '';
	if (t.length < 1 || t.length > GAME_TITLE_MAX)
		return { ok: false, error: `title must be 1-${GAME_TITLE_MAX} characters` };
	return { ok: true, value: t };
}

export function checkUrl(v: unknown, hubOrigin?: string): Checked<string> {
	const u = cleanHttpsUrl(v);
	if (!u) return { ok: false, error: 'url must be a full https:// address' };
	if (isHubOrigin(u, hubOrigin)) return { ok: false, error: 'url must not be on the hub itself' };
	return { ok: true, value: u };
}

/** Image is optional: undefined/null/blank means none. */
export function checkImage(v: unknown): Checked<string | null> {
	if (v === undefined || v === null || (typeof v === 'string' && v.trim() === ''))
		return { ok: true, value: null };
	const u = cleanHttpsUrl(v);
	return u
		? { ok: true, value: u }
		: { ok: false, error: 'image must be a full https:// address or empty' };
}

/** Validates a full new game; returns the first problem found. */
export function checkNewGame(
	raw: Record<string, unknown>,
	hubOrigin?: string
): Checked<GameFields> {
	const title = checkTitle(raw.title);
	if (!title.ok) return title;
	const url = checkUrl(raw.url, hubOrigin);
	if (!url.ok) return url;
	const image = checkImage(raw.image);
	if (!image.ok) return image;
	return { ok: true, value: { title: title.value, url: url.value, image: image.value } };
}

/** Validates only the fields present in `raw`. */
export function checkPatch(
	raw: Record<string, unknown>,
	hubOrigin?: string
): Checked<Partial<GameFields>> {
	const out: Partial<GameFields> = {};
	if (raw.title !== undefined) {
		const r = checkTitle(raw.title);
		if (!r.ok) return r;
		out.title = r.value;
	}
	if (raw.url !== undefined) {
		const r = checkUrl(raw.url, hubOrigin);
		if (!r.ok) return r;
		out.url = r.value;
	}
	if (raw.image !== undefined) {
		const r = checkImage(raw.image);
		if (!r.ok) return r;
		out.image = r.value;
	}
	return { ok: true, value: out };
}

/**
 * Reads the stored value defensively: bad entries (and, given the hub's origin, any game on it)
 * are dropped, and the list is capped.
 */
export function parseGames(raw: unknown, hubOrigin?: string): Game[] {
	if (!Array.isArray(raw)) return [];
	const out: Game[] = [];
	for (const g of raw) {
		if (!g || typeof g !== 'object' || out.length >= MAX_GAMES) continue;
		const r = g as Record<string, unknown>;
		const full = checkNewGame(r, hubOrigin);
		if (typeof r.id !== 'string' || !r.id || !full.ok) continue;
		out.push({ id: r.id, ...full.value });
	}
	return out;
}

/** Moves a game one step up (-1) or down (1); a no-op at the ends or for an unknown id. */
export function moveGame(games: readonly Game[], id: string, step: -1 | 1): Game[] {
	const from = games.findIndex((g) => g.id === id);
	const to = from + step;
	const next = [...games];
	if (from < 0 || to < 0 || to >= games.length) return next;
	[next[from], next[to]] = [next[to], next[from]];
	return next;
}
