import { error, json } from '@sveltejs/kit';
import { requireAdult } from '#lib/server/auth.js';
import { readJson } from '#lib/server/api.js';
import { parseNightClockPatch } from '#lib/domain/night-clock.js';
import { readNightClock, writeNightClock } from '#lib/server/display.js';
import type { RequestHandler } from './$types';

/** Adult only. Night clock (SLP-4): { enabled } shows a dim clock at night instead of powering off. */
export const GET: RequestHandler = (event) => {
	requireAdult(event);
	return json({ enabled: readNightClock() });
};

/** Adult only. Body: { enabled: boolean }. */
export const PUT: RequestHandler = async (event) => {
	requireAdult(event);
	const enabled = parseNightClockPatch(await readJson(event.request));
	if (typeof enabled === 'string') error(400, enabled);
	writeNightClock(enabled);
	return json({ enabled: readNightClock() });
};
