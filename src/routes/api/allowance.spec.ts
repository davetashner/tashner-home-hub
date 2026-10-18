import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'hub-allowance-api-'));

const { getDb, schema } = await import('#lib/server/db/index.js');
const { awardBonus } = await import('#lib/server/domain/ledger.js');
const overview = await import('./allowance/+server.js');
const rate = await import('./allowance/rate/+server.js');
const cashout = await import('./allowance/cashout/+server.js');
const payout = await import('./allowance/payout/+server.js');
const adjust = await import('./allowance/adjust/+server.js');
const mine = await import('./members/[id]/allowance/+server.js');

const req = (method: string, body?: unknown) =>
	new Request('http://example.com/x', {
		method,
		body: body === undefined ? undefined : JSON.stringify(body)
	});
const call = (h: unknown, ev: Record<string, unknown>, adult = true) =>
	(h as (e: unknown) => Promise<Response> | Response)({
		locals: adult ? { adult: { id: 'adult', name: 'Test Adult' } } : {},
		url: new URL('http://example.com/api/allowance'),
		...ev
	});

describe('allowance API', () => {
	it('sets a rate, cashes out, shows the kid, pays out, adjusts', async () => {
		const db = getDb();
		db.insert(schema.members)
			.values({ id: 'kid', name: 'Kid A', role: 'child', color: 'blue' })
			.run();
		awardBonus(db, { memberId: 'kid', delta: 50, note: 'seed' });

		const saved = await call(rate.PUT, {
			request: req('PUT', { stars: 10, cents: 100, symbol: '$' })
		});
		expect(await saved.json()).toMatchObject({ stars: 10 });
		await expect(call(rate.PUT, { request: req('PUT', { stars: 0 }) })).rejects.toMatchObject({
			status: 400
		});

		const co = await call(cashout.POST, { request: req('POST', { memberId: 'kid', stars: 45 }) });
		expect(co.status).toBe(201);
		expect(await co.json()).toMatchObject({ starBalance: 5, balanceCents: 450 });
		await expect(
			call(cashout.POST, { request: req('POST', { memberId: 'kid', stars: 99 }) })
		).rejects.toMatchObject({ status: 400 });

		expect(await (await call(mine.GET, { params: { id: 'kid' } }, false)).json()).toEqual({
			balanceCents: 450,
			symbol: '$'
		});

		const paid = await call(payout.POST, { request: req('POST', { memberId: 'kid', cents: 200 }) });
		expect(await paid.json()).toMatchObject({ balanceCents: 250 });
		const adj = await call(adjust.POST, {
			request: req('POST', { memberId: 'kid', cents: -50, note: 'Lost' })
		});
		expect(await adj.json()).toMatchObject({ balanceCents: 200 });
		await expect(
			call(adjust.POST, { request: req('POST', { memberId: 'kid', cents: -5000, note: 'x' }) })
		).rejects.toMatchObject({ status: 409 });

		const all = await (await call(overview.GET, {})).json();
		expect(all.members).toEqual([
			expect.objectContaining({ id: 'kid', stars: 5, balanceCents: 200 })
		]);
		expect(all.history).toHaveLength(3);
	});

	it('refuses non-adults', async () => {
		for (const [h, body] of [
			[rate.PUT, {}],
			[cashout.POST, {}],
			[payout.POST, {}],
			[adjust.POST, {}]
		] as const)
			await expect(call(h, { request: req('POST', body) }, false)).rejects.toMatchObject({
				status: 401
			});
		expect(() => call(overview.GET, {}, false)).toThrow(expect.objectContaining({ status: 401 }));
	});
});
