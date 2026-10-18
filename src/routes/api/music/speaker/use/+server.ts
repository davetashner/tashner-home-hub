import { requireAdult } from '#lib/server/auth.js';
import { readJson } from '#lib/server/api.js';
import { speakerResponse, useSpeaker } from '#lib/server/speaker.js';
import type { RequestHandler } from './$types';

/** Body: { mac }. Pairs, connects and selects that speaker. */
export const POST: RequestHandler = async (event) => {
	requireAdult(event);
	const body = await readJson(event.request);
	return speakerResponse(() => useSpeaker(body.mac));
};
