import { error, json } from '@sveltejs/kit';
import { requireAdult } from '#lib/server/auth.js';
import { GoogleError } from '#lib/server/calendar/google.js';
import { startPickerConsent } from '#lib/server/photo-source/google-import.js';
import type { RequestHandler } from './$types';

/** Step 1: the Google consent URL for the Photos Picker scope, plus the `state` to send back. */
export const POST: RequestHandler = (event) => {
	requireAdult(event);
	try {
		return json(startPickerConsent());
	} catch (e) {
		if (e instanceof GoogleError) error(400, e.message);
		throw e;
	}
};
