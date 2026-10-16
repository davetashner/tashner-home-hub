import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'hub-redemptions-api-'));

const { getDb, schema } = await import('#lib/server/db/index.js');
const { awardBonus } = await import('#lib/server/domain/ledger.js');
const { createReward } = await import('#lib/server/domain/rewards.js');
const api = await import('./redemptions/+server.js');

const req = (body?: unknown) =>
	new Request('http://example.com/api/redemptions', {
		method: 'POST',
		body: body === undefined ? undefined : JSON.stringify(body)
	});
const adult = { adult: { id: 'grown', name: 'Grown Up' } };
const call = (h: unknown, ev: Record<string, unknown>, locals: unknown = adult) =>
	(h as (e: unknown) => Promise<Response> | Response)({ locals, ...ev });

describe('redemptions API', () => {
	it('redeems for an adult, logs it, and refuses kids and short balances', async () => {
		const db = getDb();
		db.insert(schema.members)
			.values([
				{ id: 'grown', name: 'Grown Up', role: 'adult', color: 'blue' },
				{ id: 'kid', name: 'Test Child', role: 'child', color: 'blue' }
			])
			.run();
		const reward = createReward(db, { title: 'Ice cream', cost: 4 });
		awardBonus(db, { memberId: 'kid', delta: 5, note: 'seed' });

		await expect(
			call(api.POST, { request: req({ memberId: 'kid', rewardId: reward.id }) }, { adult: null })
		).rejects.toMatchObject({ status: 401 });

		const res = await call(api.POST, { request: req({ memberId: 'kid', rewardId: reward.id }) });
		expect(res.status).toBe(201);
		expect(await res.json()).toMatchObject({ cost: 4, balance: 1 });

		await expect(
			call(api.POST, { request: req({ memberId: 'kid', rewardId: reward.id }) })
		).rejects.toMatchObject({ status: 409 });
		await expect(call(api.POST, { request: req({ memberId: 'kid' }) })).rejects.toMatchObject({
			status: 400
		});

		const url = new URL('http://example.com/api/redemptions?memberId=kid&limit=x');
		const log = await (await call(api.GET, { url })).json();
		expect(log).toHaveLength(1);
		expect(log[0]).toMatchObject({
			rewardTitle: 'Ice cream',
			stars: 4,
			approvedByName: 'Grown Up'
		});
		expect(() =>
			call(api.GET, { url: new URL('http://example.com/api/redemptions') }, { adult: null })
		).toThrow(expect.objectContaining({ status: 401 }));
		const none = new URL('http://example.com/api/redemptions?memberId=nobody');
		expect(await (await call(api.GET, { url: none })).json()).toEqual([]);
	});
});
