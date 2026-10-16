import { error, json } from '@sveltejs/kit';
import { requireAdult } from '#lib/server/auth.js';
import { GoogleError } from '#lib/server/calendar/google.js';
import { startConsent } from '#lib/server/calendar/google-connect.js';
import type { RequestHandler } from './$types';

/** Step 1: returns the Google consent URL (open it on any device) and the `state` to send back. */
export const POST: RequestHandler = (event) => {
	requireAdult(event);
	try {
		return json(startConsent());
	} catch (e) {
		if (e instanceof GoogleError) error(400, e.message);
		throw e;
	}
};
