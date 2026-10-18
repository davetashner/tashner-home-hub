import { getDb } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { allowanceBalances, allowanceHistory, getRate } from '#lib/server/domain/allowance.js';
import { balances } from '#lib/server/domain/ledger.js';
import { members } from '#lib/server/db/schema.js';
import { handle } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** The rate, each child's star and money balance, and the ledger (newest first). Adults only. */
export const GET: RequestHandler = (event) => {
	requireAdult(event);
	const limit = Number(event.url.searchParams.get('limit') ?? 100) || 100;
	return handle(() => {
		const db = getDb();
		const money = allowanceBalances(db);
		const stars = balances(db);
		return {
			rate: getRate(db),
			members: db
				.select()
				.from(members)
				.all()
				.filter((m) => m.role === 'child')
				.map((m) => ({
					id: m.id,
					name: m.name,
					color: m.color,
					avatar: m.avatar,
					stars: stars[m.id] ?? 0,
					balanceCents: money[m.id] ?? 0
				})),
			history: allowanceHistory(db, { limit })
		};
	});
};
