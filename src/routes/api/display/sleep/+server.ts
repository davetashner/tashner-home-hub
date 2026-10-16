import { json } from '@sveltejs/kit';
import { recordPowerEvent } from '#lib/server/display.js';
import type { RequestHandler } from './$types';

/**
 * "Sleep now" (SLP-2). Unauthenticated on purpose: a kid taps it on the wall (LAN only).
 * Records the event and answers with the resulting state; the Pi agent picks it up by polling
 * GET /api/display/power.
 */
export const POST: RequestHandler = () =>
	json(recordPowerEvent('sleep'), { status: 202, headers: { 'cache-control': 'no-store' } });
