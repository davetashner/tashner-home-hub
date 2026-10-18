/** Siri / Shortcuts helpers (hub-6tr): scopes, loose name matching, spoken replies. Pure, no I/O. */

export const SIRI_SCOPES = ['lists:add', 'chores:create'] as const;
/** Granted to Home Assistant tokens only (hub-068); not offered on the Siri page. */
export const DISPLAY_SCOPE = 'display:power' as const;
export const TOKEN_SCOPES = [...SIRI_SCOPES, DISPLAY_SCOPE] as const;
export type SiriScope = (typeof TOKEN_SCOPES)[number];

export const SCOPE_LABELS: Record<SiriScope, string> = {
	'lists:add': 'Add list items',
	'chores:create': 'Create Star Jobs',
	'display:power': 'Wake or sleep the screen'
};

export const TOKEN_NAME_MAX = 40;
export const SIRI_STARS_MAX = 5;

export function isScope(v: unknown): v is SiriScope {
	return typeof v === 'string' && (TOKEN_SCOPES as readonly string[]).includes(v);
}

/** Lowercase letters and digits only, minus a leading "the" and a trailing "list(s)", singularized. */
export function normalizeName(raw: string): string {
	let s = raw
		.toLowerCase()
		.replace(/[^a-z0-9 ]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	s = s.replace(/^the /, '').replace(/ lists?$/, '');
	s = s.replace(/ /g, '');
	if (s.endsWith('ies') && s.length > 4) return `${s.slice(0, -3)}y`;
	if (s.endsWith('es') && s.length > 4) return s.slice(0, -2);
	if (s.endsWith('s') && s.length > 3) return s.slice(0, -1);
	return s;
}

export type Match<T> =
	{ kind: 'match'; value: T } | { kind: 'none' } | { kind: 'ambiguous'; options: T[] };

/**
 * Finds the one candidate a spoken name means: exact (after normalizing), else a unique
 * prefix either way round ("groceries" finds "Grocery", "mad" finds "Madison").
 */
export function matchName<T>(query: unknown, candidates: readonly T[], label: (c: T) => string) {
	const q = typeof query === 'string' ? normalizeName(query) : '';
	if (!q) return { kind: 'none' } as Match<T>;
	const norm = candidates.map((c) => ({ c, n: normalizeName(label(c)) }));
	const exact = norm.filter((x) => x.n === q);
	if (exact.length === 1) return { kind: 'match', value: exact[0].c } as Match<T>;
	if (exact.length > 1) return { kind: 'ambiguous', options: exact.map((x) => x.c) } as Match<T>;
	if (q.length < 2) return { kind: 'none' } as Match<T>;
	const near = norm.filter((x) => x.n.startsWith(q) || (x.n.length >= 3 && q.startsWith(x.n)));
	if (near.length === 1) return { kind: 'match', value: near[0].c } as Match<T>;
	if (near.length > 1) return { kind: 'ambiguous', options: near.map((x) => x.c) } as Match<T>;
	return { kind: 'none' } as Match<T>;
}

/** "a, b and c" */
export function spokenList(names: readonly string[]): string {
	if (names.length <= 1) return names.join('');
	return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Stars from a JSON number or a Shortcuts text value; undefined = not given; null = invalid. */
export function parseStars(v: unknown): number | undefined | null {
	if (v === undefined || v === null || v === '') return undefined;
	const n = typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? Number(v) : v;
	if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > SIRI_STARS_MAX) return null;
	return n;
}

/** Reads `Authorization: Bearer <token>`; null when absent or malformed. */
export function bearerToken(header: string | null): string | null {
	const m = /^Bearer\s+([A-Za-z0-9_-]{20,200})\s*$/i.exec(header ?? '');
	return m ? m[1] : null;
}

/** Sliding-window limiter keyed by token id. In-memory: one server process. */
export class RateLimiter {
	private hits = new Map<string, number[]>();
	constructor(
		private limit = 30,
		private windowMs = 60_000
	) {}

	/** Records an attempt; false when the key is over its limit. */
	take(key: string, now = Date.now()): boolean {
		const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
		if (recent.length >= this.limit) {
			this.hits.set(key, recent);
			return false;
		}
		recent.push(now);
		this.hits.set(key, recent);
		return true;
	}
}
