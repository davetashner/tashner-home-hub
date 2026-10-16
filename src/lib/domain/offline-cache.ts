/** What the service worker may keep for offline use (NFR-6). Adult-only data is never listed. */

export const API_TIMEOUT_MS = 2_500;
export const PHOTO_CACHE_MAX = 150;

/** Kid-visible reads only; everything else under /api is passed straight through. */
const API_READS = [
	/^\/api\/members$/,
	/^\/api\/members\/[^/]+\/(chores|stars|goal)$/,
	/^\/api\/calendar\/(events|status)$/,
	/^\/api\/approvals\/count$/,
	// The slideshow's list and settings: fresh when online (new photos show up), kept for offline.
	/^\/api\/photo\/slideshow$/,
	/^\/api\/settings\/slideshow$/
];
const PHOTO = /^\/api\/photo\/[^/]+$/;
/** Screens a child can open; settings, setup and unlock are adult flows and stay uncached. */
const SCREEN = /^\/(chores|calendar|lists|meals)?$/;
const SCREEN_DATA = /^(\/(chores|calendar|lists|meals))?\/__data\.json$/;

export type RouteKind = 'api' | 'photo' | 'page' | 'other';

export function routeKind(method: string, url: URL, isNavigation: boolean): RouteKind {
	if (method !== 'GET') return 'other';
	const path = url.pathname;
	if (API_READS.some((re) => re.test(path))) return 'api';
	if (PHOTO.test(path)) return 'photo';
	if ((isNavigation && SCREEN.test(path)) || SCREEN_DATA.test(path)) return 'page';
	return 'other';
}

/** Only plain, successful, cookie-free responses are stored. */
export function isStorable(res: {
	status: number;
	redirected: boolean;
	headers: { has(name: string): boolean };
}): boolean {
	return res.status === 200 && !res.redirected && !res.headers.has('set-cookie');
}

/** Oldest-first keys to evict so at most `max` remain. */
export function keysToEvict<T>(keys: readonly T[], max: number): T[] {
	return keys.length > max ? keys.slice(0, keys.length - max) : [];
}

/**
 * Whether the worker should handle requests. Only headless automation (CI) turns it off by
 * default; the headed kiosk Chromium stays on even with a debugging port. `hub.sw` overrides:
 * 'on' forces on, 'off' forces off.
 */
export function swEnabled(userAgent: string, override: string | null): boolean {
	if (override === 'on') return true;
	if (override === 'off') return false;
	return !/HeadlessChrome/.test(userAgent);
}

/** No exact match (the date or range moved on): the newest saved copy of the same path, if any. */
export function pickFallback(keys: readonly string[], target: string): string | null {
	const path = new URL(target).pathname;
	const same = keys.filter((k) => new URL(k).pathname === path);
	return same.length ? same[same.length - 1] : null;
}
