import { error } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { awardBonus } from '#lib/server/domain/ledger.js';
import { notifyGoalsReached } from '#lib/server/notify.js';
import { handle, readJson, str } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** Body: { delta (non-zero integer, negative = deduction), note }. */
export const POST: RequestHandler = async (event) => {
	requireAdult(event);
	const body = await readJson(event.request);
	if (typeof body.delta !== 'number') error(400, 'delta must be a number');
	const note = str(body.note, 'note');
	return handle(() => {
		const tx = awardBonus(getDb(), {
			memberId: event.params.id,
			delta: body.delta as number,
			note
		});
		notifyGoalsReached(getDb());
		return tx;
	});
};
