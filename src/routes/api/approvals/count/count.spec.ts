import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'hub-approvals-count-'));

const { getDb, schema } = await import('#lib/server/db/index.js');
const { approveCompletion, completeChore, createChore } =
	await import('#lib/server/domain/ledger.js');
const count = await import('./+server.js');

const get = async () =>
	(await (count.GET as unknown as (e: unknown) => Response)({ locals: {} })).json();

describe('GET /api/approvals/count', () => {
	it('is open and returns only a count of pending completions', async () => {
		const db = getDb();
		db.insert(schema.members)
			.values({ id: 'kid', name: 'Test Kid', role: 'child', color: 'member-1' })
			.run();
		expect(await get()).toEqual({ pending: 0, ready: 0, total: 0 });

		const a = createChore(db, { title: 'A', memberIds: ['kid'] });
		const b = createChore(db, { title: 'B', memberIds: ['kid'] });
		const ca = completeChore(db, { choreId: a.id, memberId: 'kid', date: '2026-01-05', now: 1 });
		completeChore(db, { choreId: b.id, memberId: 'kid', date: '2026-01-05', now: 2 });
		expect(await get()).toEqual({ pending: 2, ready: 0, total: 2 });

		approveCompletion(db, ca.completion.id);
		expect(await get()).toEqual({ pending: 1, ready: 0, total: 1 });
	});
});
