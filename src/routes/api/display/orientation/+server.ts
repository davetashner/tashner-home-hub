import { json } from '@sveltejs/kit';
import { displayOrientation } from '#lib/domain/orientation.js';
import { readRotation } from '#lib/server/display.js';
import type { RequestHandler } from './$types';

/**
 * Read-only, unauthenticated (LAN) and cheap: the Pi display agent polls this to learn how to
 * rotate the output and touch input. Body: { rotation: "normal"|"90"|"180"|"270", orientation }.
 */
export const GET: RequestHandler = () =>
	json(displayOrientation(readRotation()), { headers: { 'cache-control': 'no-store' } });
