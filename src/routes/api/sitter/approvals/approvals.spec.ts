import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'hub-sitter-approvals-'));

const { getDb, schema } = await import('#lib/server/db/index.js');
const { createChore, completeChore } = await import('#lib/server/domain/ledger.js');
const { createSession, currentSession, endSession } = await import('#lib/server/domain/sitter.js');
const route = await import('./+server.js');

const call = (body: unknown) =>
	(route.POST as unknown as (e: unknown) => Promise<Response>)({
		request: new Request('http://example.com/x', { method: 'POST', body: JSON.stringify(body) }),
		getClientAddress: () => '10.0.0.7'
	});

describe('sitter approvals API', () => {
	it('lists and approves with the sitter PIN only when approving is allowed', async () => {
		const db = getDb();
		db.insert(schema.members)
			.values({ id: 'kid', name: 'Test Child', role: 'child', color: 'blue' })
			.run();
		const chore = createChore(db, { title: 'Dishes', stars: 2 });
		const { completion } = completeChore(db, {
			choreId: chore.id,
			memberId: 'kid',
			date: '2026-10-17',
			now: Date.now()
		});

		const now = Date.now();
		createSession(db, { endAt: now + 3_600_000, pin: '4812' }, now);
		expect((await call({ pin: '4812', action: 'list' })).status).toBe(403);
		endSession(db, currentSession(db, now)!.id, now);

		createSession(db, { endAt: now + 3_600_000, pin: '4812', approveJobs: true }, now + 1);
		expect((await call({ pin: '0000', action: 'list' })).status).toBe(403);
		const list = await (await call({ pin: '4812', action: 'list' })).json();
		expect(list).toHaveLength(1);
		expect((await call({ pin: '4812', action: 'nope' })).status).toBe(400);
		const done = await call({ pin: '4812', action: 'approve', completionId: completion.id });
		expect(done.status).toBe(200);
		expect((await done.json()).status).toBe('approved');
		expect(await (await call({ pin: '4812', action: 'list' })).json()).toHaveLength(0);
	});
});
