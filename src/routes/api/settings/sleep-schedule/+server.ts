import { error, json } from '@sveltejs/kit';
import { requireAdult } from '#lib/server/auth.js';
import { readJson } from '#lib/server/api.js';
import { applySleepPatch, parseSleepPatch } from '#lib/domain/display-power.js';
import { readSleepSchedule, writeSleepSchedule } from '#lib/server/display.js';
import type { RequestHandler } from './$types';

/** Adult only. The sleep schedule: { enabled, weekday: {sleep, wake}, weekend: {...}, resleepMinutes }. */
export const GET: RequestHandler = (event) => {
	requireAdult(event);
	return json(readSleepSchedule());
};

/**
 * Adult only. Flat partial body: { enabled?, weekdaySleep?, weekdayWake?, weekendSleep?,
 * weekendWake?, resleepMinutes? } with times as 24-hour "HH:MM".
 */
export const PUT: RequestHandler = async (event) => {
	requireAdult(event);
	const patch = parseSleepPatch(await readJson(event.request));
	if (typeof patch === 'string') error(400, patch);
	writeSleepSchedule(applySleepPatch(readSleepSchedule(), patch));
	return json(readSleepSchedule());
};
