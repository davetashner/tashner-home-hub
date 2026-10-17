import { getDb } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { adjustStars } from '#lib/server/domain/bonus.js';
import { handle, readJson } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/**
 * Body: { delta (non-zero integer, negative = deduction), note? }. The note is optional for a
 * bonus and required for a deduction. A deduction is clamped to the balance.
 * Replies with the ledger row plus `balance` and `clamped`.
 */
export const POST: RequestHandler = async (event) => {
	requireAdult(event);
	const body = await readJson(event.request);
	return handle(() => {
		const r = adjustStars(getDb(), {
			memberId: event.params.id,
			delta: body.delta,
			note: body.note
		});
		return { ...r.transaction, balance: r.balance, clamped: r.clamped };
	});
};
