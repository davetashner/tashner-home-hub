import { getDb } from '#lib/server/db/index.js';
import { allowanceBalance, getRate } from '#lib/server/domain/allowance.js';
import { handle } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** Read-only: a child's allowance balance for their own reward screen (like /stars). */
export const GET: RequestHandler = ({ params }) =>
	handle(() => {
		const db = getDb();
		return { balanceCents: allowanceBalance(db, params.id), symbol: getRate(db).symbol };
	});
