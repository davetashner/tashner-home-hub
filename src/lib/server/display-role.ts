import type { RequestEvent } from '@sveltejs/kit';
import {
	DISPLAY_COOKIE,
	DISPLAY_MAX_AGE_S,
	parseDisplayRole,
	type DisplayRole
} from '#lib/domain/display-role.js';
import { overHttps } from '#lib/server/auth.js';

/** This browser's role from its device cookie; a browser without one is personal. */
export function displayRole(event: Pick<RequestEvent, 'cookies'>): DisplayRole {
	return parseDisplayRole(event.cookies.get(DISPLAY_COOKIE));
}

export function setDisplayRole(
	event: Pick<RequestEvent, 'cookies' | 'url' | 'platform'>,
	role: DisplayRole
): void {
	event.cookies.set(DISPLAY_COOKIE, role, {
		path: '/',
		// The client gets the role through layout data, so script never needs the cookie.
		httpOnly: true,
		sameSite: 'strict',
		secure: overHttps(event),
		maxAge: DISPLAY_MAX_AGE_S
	});
}
