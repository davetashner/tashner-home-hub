import { error, json } from '@sveltejs/kit';
import { requireAdult } from '#lib/server/auth.js';
import { readJson } from '#lib/server/api.js';
import { parseBirthdays } from '#lib/domain/birthdays.js';
import { readBirthdays, writeBirthdays } from '#lib/server/birthdays.js';
import type { RequestHandler } from './$types';

/** Adult only: the labels are private to settings. The wall gets the dates alone, via layout data. */
export const GET: RequestHandler = (event) => {
	requireAdult(event);
	return json({ birthdays: readBirthdays() });
};

/** Adult only. Body: { birthdays: [{ month: 1-12, day: 1-31, label?: string }] }, replacing the list. */
export const PUT: RequestHandler = async (event) => {
	requireAdult(event);
	const list = parseBirthdays(await readJson(event.request));
	if (typeof list === 'string') error(400, list);
	writeBirthdays(list);
	return json({ birthdays: readBirthdays() });
};
