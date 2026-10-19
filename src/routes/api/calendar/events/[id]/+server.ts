import { error, json } from '@sveltejs/kit';
import { requireAdult } from '#lib/server/auth.js';
import { readJson } from '#lib/server/api.js';
import {
	deleteCalendarEvent,
	EditEventError,
	updateCalendarEvent
} from '#lib/server/calendar/edit.js';
import { getDb } from '#lib/server/db/index.js';
import type { RequestHandler } from './$types';

/** CAL-9: adults edit a non-recurring iCloud or Google event. */
export const PUT: RequestHandler = async (event) => {
	requireAdult(event);
	const body = await readJson(event.request);
	try {
		await updateCalendarEvent(getDb(), event.params.id, body);
		return json({ ok: true });
	} catch (e) {
		if (e instanceof EditEventError) error(e.status, e.message);
		throw e;
	}
};

/** CAL-9: adults delete a non-recurring iCloud or Google event. */
export const DELETE: RequestHandler = async (event) => {
	requireAdult(event);
	try {
		await deleteCalendarEvent(getDb(), event.params.id);
		return json({ ok: true });
	} catch (e) {
		if (e instanceof EditEventError) error(e.status, e.message);
		throw e;
	}
};
