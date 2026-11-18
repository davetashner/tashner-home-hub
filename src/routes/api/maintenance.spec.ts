import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'hub-maintenance-api-'));

const list = await import('./maintenance/+server.js');
const one = await import('./maintenance/[id]/+server.js');
const done = await import('./maintenance/[id]/done/+server.js');
const count = await import('./maintenance/due-count/+server.js');
const { localDate } = await import('#lib/server/api.js');

const req = (method: string, body?: unknown) =>
	new Request('http://example.com/x', {
		method,
		body: body === undefined ? undefined : JSON.stringify(body)
	});
const call = async (h: unknown, ev: Record<string, unknown>, adult = true) =>
	(h as (e: unknown) => Promise<Response> | Response)({
		locals: { adult: adult ? { id: 'adult', name: 'Test Adult' } : null },
		...ev
	});
const dueCount = async () => (await (await call(count.GET, {}, false)).json()).due as number;

describe('maintenance API', () => {
	it('adds, lists, marks done, edits and deletes', async () => {
		const today = localDate(Date.now());
		const res = await call(
			list.POST,
			{
				request: req('POST', { title: 'Change filter', intervalMonths: 3, nextDue: '2000-01-01' })
			},
			false
		);
		expect(res.status).toBe(201);
		const task = await res.json();
		const all = await (await call(list.GET, {}, false)).json();
		expect(all.today).toBe(today);
		expect(all.tasks).toHaveLength(1);
		expect(await dueCount()).toBe(1);

		const marked = await (
			await call(done.POST, { params: { id: task.id }, request: req('POST', {}) }, false)
		).json();
		expect(marked.lastDone).toBe(today);
		expect(await dueCount()).toBe(0);
		const backdated = await (
			await call(done.POST, {
				params: { id: task.id },
				request: req('POST', { date: '2026-11-17' })
			})
		).json();
		expect(backdated).toMatchObject({ lastDone: '2026-11-17', nextDue: '2027-02-17' });

		const patched = await (
			await call(
				one.PATCH,
				{ params: { id: task.id }, request: req('PATCH', { notes: 'More often with pets' }) },
				false
			)
		).json();
		expect(patched.notes).toBe('More often with pets');

		await expect(call(one.DELETE, { params: { id: task.id } }, false)).rejects.toMatchObject({
			status: 401
		});
		expect((await call(one.DELETE, { params: { id: task.id } })).status).toBe(200);
		expect((await (await call(list.GET, {})).json()).tasks).toHaveLength(0);
	});

	it('rejects bad input and missing tasks', async () => {
		await expect(call(list.POST, { request: req('POST', { title: '' }) })).rejects.toMatchObject({
			status: 400
		});
		await expect(
			call(done.POST, { params: { id: 'nope' }, request: req('POST', {}) })
		).rejects.toMatchObject({ status: 404 });
		await expect(
			call(one.PATCH, { params: { id: 'nope' }, request: req('PATCH', { title: 'x' }) })
		).rejects.toMatchObject({ status: 404 });
	});
});
