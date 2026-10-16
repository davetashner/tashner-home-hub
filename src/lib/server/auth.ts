import type { RequestEvent } from '@sveltejs/kit';

/**
 * Adult-only gate for API routes.
 *
 * TODO(hub-ea5.2): STUB. Currently allows every request. The PIN/session bead must
 * replace this body with a real check (valid adult session) and throw
 * `error(403)` / return false otherwise. Routes call only this function, so no
 * route changes are needed when it is implemented.
 */
export function requireAdult(event: RequestEvent): void {
	void event;
}

/**
 * Whether the caller holds an adult session, without rejecting. Used where kids
 * and adults share a route but get different rules (e.g. undo window).
 *
 * TODO(hub-ea5.2): STUB. Returns false (least privilege) until the PIN bead lands.
 */
export function isAdult(event: RequestEvent): boolean {
	void event;
	return false;
}
