import { error, json } from '@sveltejs/kit';
import { requireAdult } from '#lib/server/auth.js';
import { readJson } from '#lib/server/api.js';
import { CreateEventError, createCalendarEvent } from '#lib/server/calendar/create.js';
import { getDb } from '#lib/server/db/index.js';
import { listEvents } from '#lib/server/calendar/read.js';
import type { RequestHandler } from './$types';

function ms(v: string | null, name: string): number {
	const n = v === null || v === '' ? NaN : /^\d+$/.test(v) ? Number(v) : Date.parse(v);
	if (!Number.isFinite(n)) error(400, `${name} must be epoch ms or an ISO date`);
	return n;
}

export const GET: RequestHandler = ({ url }) => {
	const start = ms(url.searchParams.get('start'), 'start');
	const end = ms(url.searchParams.get('end'), 'end');
	if (end <= start) error(400, 'end must be after start');
	return json(listEvents(getDb(), start, end));
};

/** CAL-9: adults add an event to an iCloud calendar. */
export const POST: RequestHandler = async (event) => {
	requireAdult(event);
	const body = await readJson(event.request);
	try {
		return json(await createCalendarEvent(getDb(), body), { status: 201 });
	} catch (e) {
		if (e instanceof CreateEventError) error(e.status, e.message);
		throw e;
	}
};
