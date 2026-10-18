import { error, json } from '@sveltejs/kit';
import { readJson } from '#lib/server/api.js';
import { requireAdult } from '#lib/server/auth.js';
import { GoogleError } from '#lib/server/calendar/google.js';
import { parsePasted } from '#lib/server/calendar/google-connect.js';
import { finishPickerConsent, isConnected } from '#lib/server/photo-source/google-import.js';
import type { RequestHandler } from './$types';

/** Step 2: the adult pastes the address Google redirected to (it fails to load on purpose). */
export const POST: RequestHandler = async (event) => {
	requireAdult(event);
	const body = await readJson(event.request);
	const pasted = typeof body.pasted === 'string' && body.pasted.length <= 2000 ? body.pasted : '';
	const stateIn = typeof body.state === 'string' ? body.state : '';
	if (!pasted) error(400, 'pasted is required');
	try {
		const { code, state } = parsePasted(pasted);
		await finishPickerConsent(code, state ?? stateIn);
		return json({ connected: isConnected() }, { status: 201 });
	} catch (e) {
		if (e instanceof GoogleError) error(400, e.message);
		throw e;
	}
};
