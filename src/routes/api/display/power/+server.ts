import { json } from '@sveltejs/kit';
import { currentDisplayState } from '#lib/server/display.js';
import type { RequestHandler } from './$types';

/**
 * Read-only, unauthenticated (LAN) and cheap: the Pi display agent polls this to switch the
 * monitor. Body: { power: "on"|"off", reason: "schedule"|"sleep-now"|"wake"|"disabled", until?, mode: "normal"|"night-clock"|"off" }.
 * With night clock on, a scheduled night reports power "on" and mode "night-clock" (SLP-4).
 */
export const GET: RequestHandler = () =>
	json(currentDisplayState(), { headers: { 'cache-control': 'no-store' } });
