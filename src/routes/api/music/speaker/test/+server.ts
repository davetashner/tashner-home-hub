import { requireAdult } from '#lib/server/auth.js';
import { speakerResponse, testSpeaker } from '#lib/server/speaker.js';
import type { RequestHandler } from './$types';

/** Plays a short chime on the speaker. */
export const POST: RequestHandler = (event) => {
	requireAdult(event);
	return speakerResponse(async () => {
		await testSpeaker();
		return { ok: true };
	});
};
