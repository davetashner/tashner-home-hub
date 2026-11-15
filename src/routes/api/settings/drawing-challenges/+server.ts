import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { readJson } from '#lib/server/api.js';
import {
	parseChallengeInput,
	removeChallenge,
	setChallenge
} from '#lib/domain/drawing-challenges.js';
import { readChallenges, writeChallenges } from '#lib/server/domain/drawing-challenges.js';
import type { RequestHandler } from './$types';

/** Pending challenges for kids: [{ id, memberId, text }]. Anyone may read them (the board shows them). */
export const GET: RequestHandler = () => json(readChallenges(getDb()));

/** Adult only. Body: { memberId, text }. Replaces that kid's challenge. */
export const POST: RequestHandler = async (event) => {
	requireAdult(event);
	const input = parseChallengeInput(await readJson(event.request));
	if (typeof input === 'string') error(400, input);
	const db = getDb();
	const member = db
		.select()
		.from(schema.members)
		.where(eq(schema.members.id, input.memberId))
		.get();
	if (!member || member.role !== 'child') error(400, 'Pick a kid');
	const next = { id: crypto.randomUUID(), ...input };
	writeChallenges(db, setChallenge(readChallenges(db), next));
	return json(next, { status: 201 });
};

/** Adult only. Body: { id }. Takes a challenge away without it being done. */
export const DELETE: RequestHandler = async (event) => {
	requireAdult(event);
	const body = await readJson(event.request);
	if (typeof body.id !== 'string' || !body.id) error(400, 'id is required');
	const db = getDb();
	writeChallenges(db, removeChallenge(readChallenges(db), body.id));
	return json(readChallenges(db));
};
