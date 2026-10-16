import { getDb } from '#lib/server/db/index.js';
import { completeChore } from '#lib/server/domain/ledger.js';
import { dateStr, handle, localDate, readJson, str } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** Body: { memberId, date? }. Idempotent per chore/member/day. */
export const POST: RequestHandler = async ({ params, request }) => {
	const body = await readJson(request);
	const now = Date.now();
	const memberId = str(body.memberId, 'memberId');
	const date = body.date === undefined ? localDate(now) : dateStr(body.date);
	return handle(() => completeChore(getDb(), { choreId: params.id, memberId, date, now }));
};
