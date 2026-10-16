import { error, json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { readJson } from '#lib/server/api.js';
import { requireAdult } from '#lib/server/auth.js';
import { GoogleError } from '#lib/server/calendar/google.js';
import { finishConsent } from '#lib/server/calendar/google-connect.js';
import { listSources } from '#lib/server/calendar/sources.js';
import type { RequestHandler } from './$types';

const opt = (v: unknown) => (typeof v === 'string' && v.length <= 2000 ? v : undefined);

/**
 * Step 2: the adult pastes the address Google redirected to (it fails to load on purpose).
 * Stores the source (or re-authorizes `sourceId`) and returns it with its discovered calendars.
 */
export const POST: RequestHandler = async (event) => {
	requireAdult(event);
	const body = await readJson(event.request);
	const pasted = opt(body.pasted);
	if (!pasted) error(400, 'pasted is required');
	const db = getDb();
	try {
		const r = await finishConsent(db, {
			pasted,
			state: opt(body.state),
			label: opt(body.label),
			sourceId: opt(body.sourceId)
		});
		return json(
			{ ...listSources(db).find((s) => s.id === r.id), discovered: r.calendars },
			{ status: 201 }
		);
	} catch (e) {
		if (e instanceof GoogleError) error(400, e.message);
		throw e;
	}
};
