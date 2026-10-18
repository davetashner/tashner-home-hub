import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'hub-fun-lock-api-'));

const { getDb, schema } = await import('#lib/server/db/index.js');
const { createChore } = await import('#lib/server/domain/ledger.js');
const { MISSED_SINCE_KEY } = await import('#lib/server/domain/missed.js');
const one = await import('./members/[id]/fun-lock/+server.js');
const unlock = await import('./members/[id]/fun-lock/unlock/+server.js');
const all = await import('./fun-lock/+server.js');

const call = (h: unknown, ev: Record<string, unknown>) =>
	(h as (e: unknown) => Promise<Response> | Response)(ev);

describe('fun-lock API', () => {
	it('locks after a miss for anyone to read, and only an adult can unlock (logged)', async () => {
		const db = getDb();
		db.insert(schema.members)
			.values([
				{ id: 'grown', name: 'Grown Up', role: 'adult', color: 'blue' },
				{ id: 'kid', name: 'Test Child', role: 'child', color: 'red' }
			])
			.run();
		const three = Date.now() - 3 * 86_400_000;
		const job = createChore(db, {
			title: 'Dishes',
			memberIds: ['kid'],
			schedule: 'DTSTART:20200101T000000Z\nRRULE:FREQ=DAILY',
			requiresApproval: false
		});
		db.update(schema.chores).set({ createdAt: three }).run();
		db.insert(schema.settings)
			.values({ key: MISSED_SINCE_KEY, value: JSON.stringify('2020-01-01') })
			.run();

		const read = await call(one.GET, { params: { id: 'kid' } });
		expect(await read.json()).toMatchObject({
			locked: true,
			remaining: [{ id: job.id, title: 'Dishes' }]
		});
		const everyone = (await (await call(all.GET, {})).json()) as { memberId: string }[];
		expect(everyone.map((s) => s.memberId)).toEqual(['kid']);

		const event = (locals: unknown) => ({ params: { id: 'kid' }, locals });
		expect(() => call(unlock.POST, event({ adult: null }))).toThrow(
			expect.objectContaining({ status: 401 })
		);
		expect(() =>
			call(unlock.POST, { params: { id: 'grown' }, locals: { adult: { id: 'grown', name: 'G' } } })
		).toThrow(expect.objectContaining({ status: 404 }));
		const res = await call(unlock.POST, event({ adult: { id: 'grown', name: 'Grown Up' } }));
		expect(await res.json()).toMatchObject({ locked: false, unlockedToday: true });
		expect(db.select().from(schema.funUnlocks).all()).toEqual([
			expect.objectContaining({ memberId: 'kid', unlockedBy: 'grown', unlockedByName: 'Grown Up' })
		]);
	});
});
