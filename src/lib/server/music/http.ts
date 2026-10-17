import { json } from '@sveltejs/kit';
import { MusicError } from '../domain/music.js';

const STATUS = {
	no_device: 409,
	not_allowed: 403,
	not_connected: 503,
	invalid: 400,
	spotify: 502
} as const;

/** Runs a music route body and maps MusicError to `{ code, message }` JSON the UI can act on. */
export async function musicResponse(fn: () => Promise<Response>): Promise<Response> {
	try {
		return await fn();
	} catch (e) {
		if (e instanceof MusicError)
			return json({ code: e.code, message: e.message }, { status: STATUS[e.code] });
		throw e;
	}
}
