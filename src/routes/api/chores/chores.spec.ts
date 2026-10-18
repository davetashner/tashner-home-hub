import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'hub-chores-api-'));

const { getDb, schema } = await import('#lib/server/db/index.js');
const list = await import('./+server.js');
const one = await import('./[id]/+server.js');
const archive = await import('./[id]/archive/+server.js');
const completeRoute = await import('./[id]/complete/+server.js');
const memberChores = await import('../members/[id]/chores/+server.js');

const adult = { adult: { id: 'adult', name: 'Test Adult' } };
const call = async (h: unknown, ev: Record<string, unknown>) =>
	(h as (e: unknown) => Promise<Response> | Response)({ locals: adult, ...ev });
const anon = async (h: unknown, ev: Record<string, unknown>) =>
	(h as (e: unknown) => Promise<Response> | Response)({ locals: {}, ...ev });
const req = (method: string, body?: unknown) =>
	new Request('http://example.com/x', {
		method,
		body: body === undefined ? undefined : JSON.stringify(body)
	});

describe('chores API', () => {
	it('requires an adult session to create, edit or archive', async () => {
		await expect(
			anon(list.POST, { request: req('POST', { title: 'X', memberIds: [] }) })
		).rejects.toMatchObject({ status: 401 });
		await expect(
			anon(one.PATCH, { params: { id: 'x' }, request: req('PATCH', { stars: 2 }) })
		).rejects.toMatchObject({ status: 401 });
		await expect(anon(archive.POST, { params: { id: 'x' } })).rejects.toMatchObject({
			status: 401
		});
	});

	it('create -> list -> patch -> day view -> archive', async () => {
		getDb()
			.insert(schema.members)
			.values({ id: 'kid', name: 'Test Child', role: 'child', color: 'member-1' })
			.run();

		const created = await (
			await call(list.POST, {
				request: req('POST', {
					title: 'Dishes',
					memberIds: ['kid'],
					stars: 3,
					timeOfDay: 'morning',
					schedule: { type: 'weekdays', days: ['MO'], start: '2026-01-05' }
				})
			})
		).json();
		expect(created).toMatchObject({ requiresApproval: true, timeOfDay: 'morning' });

		const all = await (await call(list.GET, { url: new URL('http://example.com/') })).json();
		expect(all).toHaveLength(1);

		const patched = await (
			await call(one.PATCH, { params: { id: created.id }, request: req('PATCH', { stars: 4 }) })
		).json();
		expect(patched.stars).toBe(4);

		const day = (q: string) =>
			call(memberChores.GET, { params: { id: 'kid' }, url: new URL(`http://example.com/?${q}`) });
		const monday = await (await day('date=2026-01-05&tz=America/Chicago')).json();
		expect(monday[0]).toMatchObject({ timeOfDay: 'morning' });
		expect(monday[0].chores[0]).toMatchObject({ title: 'Dishes', status: 'none' });
		expect(await (await day('date=2026-01-06')).json()).toEqual([]);
		expect(await (await day('')).json()).toBeInstanceOf(Array);
		await expect(day('date=bad')).rejects.toMatchObject({ status: 400 });

		await call(archive.POST, { params: { id: created.id } });
		expect(await (await call(list.GET, { url: new URL('http://example.com/') })).json()).toEqual(
			[]
		);
		const withArchived = await (
			await call(list.GET, { url: new URL('http://example.com/?archived=1') })
		).json();
		expect(withArchived).toHaveLength(1);
	});

	it('maps errors', async () => {
		await expect(call(list.POST, { request: req('POST', { title: '' }) })).rejects.toMatchObject({
			status: 400
		});
		await expect(
			call(list.POST, { request: new Request('http://x', { method: 'POST', body: '[]' }) })
		).rejects.toMatchObject({ status: 400 });
		await expect(
			call(one.PATCH, { params: { id: 'nope' }, request: req('PATCH', { title: 'x' }) })
		).rejects.toMatchObject({ status: 404 });
		await expect(call(archive.POST, { params: { id: 'nope' } })).rejects.toMatchObject({
			status: 404
		});
	});

	it('replaying a queued completion (same Idempotency-Key) awards stars once', async () => {
		const chore = await (
			await call(list.POST, {
				request: req('POST', { title: 'Offline job', memberIds: ['kid'], stars: 2 })
			})
		).json();
		const replay = () =>
			anon(completeRoute.POST, {
				params: { id: chore.id },
				request: new Request('http://example.com/x', {
					method: 'POST',
					headers: { 'idempotency-key': 'k-1' },
					body: JSON.stringify({ memberId: 'kid', date: '2026-01-05' })
				})
			});
		const first = await (await replay()).json();
		const second = await (await replay()).json();
		expect(second.completion.id).toBe(first.completion.id);
		const rows = getDb()
			.select()
			.from(schema.starTransactions)
			.all()
			.filter((t) => t.refId === first.completion.id);
		expect(rows).toHaveLength(1);
	});
});

describe('chores API kind filter (hub-obz)', () => {
	const get = (query: string) => call(list.GET, { url: new URL(`http://example.com/${query}`) });

	it('filters by valid kind, returns all without one, and 400s on a bad one', async () => {
		const habit = await (
			await call(list.POST, { request: req('POST', { title: 'Feed fish', kind: 'habit' }) })
		).json();
		const job = await (
			await call(list.POST, { request: req('POST', { title: 'Mop floor' }) })
		).json();
		const ids = async (q: string) =>
			((await (await get(q)).json()) as { id: string }[]).map((c) => c.id);

		expect(await ids('?kind=habit')).toEqual([habit.id]);
		expect(await ids('?kind=star_job')).toContain(job.id);
		expect(await ids('?kind=star_job')).not.toContain(habit.id);
		expect(await ids('')).toEqual(expect.arrayContaining([habit.id, job.id]));

		await expect(get('?kind=nap')).rejects.toMatchObject({
			status: 400,
			body: { message: expect.stringMatching(/kind must be one of/) }
		});
		await expect(get('?kind=')).rejects.toMatchObject({ status: 400 });
	});
});
