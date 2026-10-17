/**
 * Per-device display role (DEV-1). Each browser is a wall display (kiosk behaviour: idle return
 * home, photo frame, short sessions) or a personal device (none of that). The role lives in a
 * cookie on the device, never on the account.
 */
export type DisplayRole = 'wall' | 'personal';

export const DISPLAY_COOKIE = 'hub_display';
/** The launch URL query that turns a browser into a wall display (the Pi kiosk uses it). */
export const DISPLAY_PARAM = 'display';
/** About ten years: a role is set once per device. */
export const DISPLAY_MAX_AGE_S = 60 * 60 * 24 * 365 * 10;

/** Anything but an explicit "wall" is personal, so a new or odd browser never acts like the kiosk. */
export function parseDisplayRole(value: unknown): DisplayRole {
	return value === 'wall' ? 'wall' : 'personal';
}

export function isDisplayRole(value: unknown): value is DisplayRole {
	return value === 'wall' || value === 'personal';
}

/** "Remember me" is on by default on a personal device, off on a shared wall screen. */
export function defaultRemember(role: DisplayRole): boolean {
	return role === 'personal';
}

/** Whether the kiosk behaviours (idle return home, photo frame) apply. */
export function hasKioskBehaviour(role: DisplayRole): boolean {
	return role === 'wall';
}

/**
 * If the URL carries a valid `?display=` role, returns it plus the same URL path without that
 * parameter (to redirect to, so the query never lingers in the address bar). Otherwise null.
 */
export function readDisplayParam(url: URL): { role: DisplayRole; location: string } | null {
	const value = url.searchParams.get(DISPLAY_PARAM);
	if (!isDisplayRole(value)) return null;
	const rest = new URLSearchParams(url.searchParams);
	rest.delete(DISPLAY_PARAM);
	const query = rest.toString();
	return { role: value, location: url.pathname + (query ? `?${query}` : '') + url.hash };
}
