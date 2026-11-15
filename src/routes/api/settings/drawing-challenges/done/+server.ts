import { error, json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { readJson } from '#lib/server/api.js';
import { clearForMember, removeChallenge } from '#lib/domain/drawing-challenges.js';
import { readChallenges, writeChallenges } from '#lib/server/domain/drawing-challenges.js';
import type { RequestHandler } from './$types';

/**
 * Anyone, like finishing a chore: a kid taps Done or posts their drawing. Body: { id } (Done)
 * or { memberId } (that kid posted). Either way the challenge is cleared.
 */
export const POST: RequestHandler = async (event) => {
	const body = await readJson(event.request);
	const db = getDb();
	const list = readChallenges(db);
	if (typeof body.id === 'string' && body.id) writeChallenges(db, removeChallenge(list, body.id));
	else if (typeof body.memberId === 'string' && body.memberId)
		writeChallenges(db, clearForMember(list, body.memberId));
	else error(400, 'id or memberId is required');
	return json(readChallenges(db));
};
