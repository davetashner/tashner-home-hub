import { getDb } from '#lib/server/db/index.js';
import { balances, history, pendingStars } from '#lib/server/domain/ledger.js';
import { handle } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** Query: limit (1-200, default 50), before (createdAt ms cursor). */
export const GET: RequestHandler = ({ params, url }) => {
	const limit = Number(url.searchParams.get('limit') ?? 50);
	const beforeRaw = url.searchParams.get('before');
	const before = beforeRaw === null ? undefined : Number(beforeRaw);
	return handle(() => {
		const db = getDb();
		return {
			balance: balances(db)[params.id] ?? 0,
			pending: pendingStars(db, params.id),
			history: history(db, params.id, {
				limit: Number.isFinite(limit) ? limit : 50,
				before: before !== undefined && Number.isFinite(before) ? before : undefined
			})
		};
	});
};
