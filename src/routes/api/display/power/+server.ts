import { json } from '@sveltejs/kit';
import { currentDisplayPower } from '#lib/server/display.js';
import type { RequestHandler } from './$types';

/**
 * Read-only, unauthenticated (LAN) and cheap: the Pi display agent polls this to switch the
 * monitor. Body: { power: "on"|"off", reason: "schedule"|"sleep-now"|"wake"|"disabled", until? }.
 */
export const GET: RequestHandler = () =>
	json(currentDisplayPower(), { headers: { 'cache-control': 'no-store' } });
