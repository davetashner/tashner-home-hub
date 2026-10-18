import { getDb } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { adjustAllowance } from '#lib/server/domain/allowance.js';
import { handle, readJson, str } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** Body: { memberId, cents (signed), note }. A manual correction. Adults only. */
export const POST: RequestHandler = async (event) => {
	requireAdult(event);
	const body = await readJson(event.request);
	const memberId = str(body.memberId, 'memberId');
	const res = handle(() =>
		adjustAllowance(getDb(), { memberId, cents: body.cents, note: body.note })
	);
	return new Response(res.body, { status: 201, headers: res.headers });
};
