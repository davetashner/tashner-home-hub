import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'hub-rewards-api-'));

const { getDb, schema } = await import('#lib/server/db/index.js');
const rewards = await import('./rewards/+server.js');
const one = await import('./rewards/[id]/+server.js');
const archive = await import('./rewards/[id]/archive/+server.js');
const goal = await import('./members/[id]/goal/+server.js');

const req = (method: string, body?: unknown) =>
	new Request('http://example.com/x', {
		method,
		body: body === undefined ? undefined : JSON.stringify(body)
	});
const call = (h: unknown, ev: Record<string, unknown>) =>
	(h as (e: unknown) => Promise<Response> | Response)({
		locals: { adult: { id: 'adult', name: 'Test Adult' } },
		...ev
	});

describe('rewards API', () => {
	it('creates, lists, edits, archives', async () => {
		const res = await call(rewards.POST, {
			request: req('POST', { title: 'Ice cream', cost: 20, image: '🍦' })
		});
		expect(res.status).toBe(201);
		const created = await res.json();
		expect(created).toMatchObject({ title: 'Ice cream', cost: 20, active: true });

		const url = new URL('http://example.com/api/rewards');
		expect(await (await call(rewards.GET, { url })).json()).toHaveLength(1);

		const patched = await (
			await call(one.PATCH, { params: { id: created.id }, request: req('PATCH', { cost: 25 }) })
		).json();
		expect(patched.cost).toBe(25);

		await call(archive.POST, { params: { id: created.id } });
		expect(await (await call(rewards.GET, { url })).json()).toHaveLength(0);
		const all = new URL('http://example.com/api/rewards?includeArchived=1');
		expect(await (await call(rewards.GET, { url: all })).json()).toHaveLength(1);
	});

	it('maps validation and missing errors', async () => {
		await expect(
			call(rewards.POST, { request: req('POST', { title: '', cost: 5 }) })
		).rejects.toMatchObject({ status: 400 });
		await expect(
			call(one.PATCH, { params: { id: 'nope' }, request: req('PATCH', { cost: 5 }) })
		).rejects.toMatchObject({ status: 404 });
		expect(() => call(archive.POST, { params: { id: 'nope' } })).toThrow(
			expect.objectContaining({ status: 404 })
		);
	});

	it('sets and gets a goal with progress', async () => {
		const db = getDb();
		db.insert(schema.members)
			.values({ id: 'kid', name: 'Test Child', role: 'child', color: 'blue' })
			.run();
		expect(await (await call(goal.GET, { params: { id: 'kid' } })).json()).toBeNull();
		const r = await (
			await call(rewards.POST, { request: req('POST', { title: 'LEGO', cost: 100 }) })
		).json();
		const set = await (
			await call(goal.PUT, { params: { id: 'kid' }, request: req('PUT', { rewardId: r.id }) })
		).json();
		expect(set).toMatchObject({ balance: 0, cost: 100, remaining: 100, percent: 0 });
		const got = await (await call(goal.GET, { params: { id: 'kid' } })).json();
		expect(got.reward.id).toBe(r.id);
		await expect(
			call(goal.PUT, { params: { id: 'kid' }, request: req('PUT', {}) })
		).rejects.toMatchObject({ status: 400 });
		await expect(
			call(goal.PUT, { params: { id: 'kid' }, request: req('PUT', { rewardId: 'nope' }) })
		).rejects.toMatchObject({ status: 404 });
	});

	describe('kid picking a goal without a grown-up', () => {
		const anon = (id: string, rewardId: unknown) =>
			(goal.PUT as unknown as (e: unknown) => Promise<Response>)({
				locals: {},
				params: { id },
				request: req('PUT', { rewardId })
			});

		it('allows a child to pick an active reward', async () => {
			getDb()
				.insert(schema.members)
				.values({ id: 'kid2', name: 'Kid Two', role: 'child', color: 'blue' })
				.run();
			const r = await (
				await call(rewards.POST, { request: req('POST', { title: 'Kite', cost: 5 }) })
			).json();
			const res = await anon('kid2', r.id);
			expect(res.status).toBe(200);
			expect((await res.json()).reward.id).toBe(r.id);
		});

		it('refuses an adult member, an unknown member, and missing or archived rewards', async () => {
			getDb()
				.insert(schema.members)
				.values({ id: 'grownup', name: 'Grown Up', role: 'adult', color: 'blue' })
				.run();
			const r = await (
				await call(rewards.POST, { request: req('POST', { title: 'Old toy', cost: 5 }) })
			).json();
			await expect(anon('grownup', r.id)).rejects.toMatchObject({ status: 401 });
			await expect(anon('ghost', r.id)).rejects.toMatchObject({ status: 401 });
			await expect(anon('kid2', 'nope')).rejects.toMatchObject({ status: 401 });
			await call(archive.POST, { params: { id: r.id } });
			await expect(anon('kid2', r.id)).rejects.toMatchObject({ status: 401 });
		});
	});
});
