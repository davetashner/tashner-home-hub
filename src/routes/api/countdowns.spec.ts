import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'hub-countdowns-api-'));

const list = await import('./countdowns/+server.js');
const one = await import('./countdowns/[id]/+server.js');

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

describe('countdowns API', () => {
	it('creates, lists, edits and deletes', async () => {
		const res = await call(list.POST, {
			request: req('POST', { title: 'Beach trip', targetDate: '2026-12-01', icon: '🏖️' })
		});
		expect(res.status).toBe(201);
		const created = await res.json();
		expect(await (await call(list.GET, {}, false)).json()).toHaveLength(1);
		const patched = await (
			await call(one.PATCH, {
				params: { id: created.id },
				request: req('PATCH', { targetDate: '2026-12-05' })
			})
		).json();
		expect(patched.targetDate).toBe('2026-12-05');
		const del = await call(one.DELETE, { params: { id: created.id } });
		expect(del.status).toBe(200);
		expect(await (await call(list.GET, {})).json()).toHaveLength(0);
	});
	it('rejects bad input and missing rows', async () => {
		await expect(
			call(list.POST, { request: req('POST', { title: 'x', targetDate: '2026-02-30' }) })
		).rejects.toMatchObject({ status: 400 });
		await expect(call(one.DELETE, { params: { id: 'nope' } })).rejects.toMatchObject({
			status: 404
		});
	});
	it('lets kids add, but only adults edit or delete', async () => {
		const res = await call(
			list.POST,
			{ request: req('POST', { title: 'Kid party', targetDate: '2026-12-01' }) },
			false
		);
		expect(res.status).toBe(201);
		const { id } = await res.json();
		await expect(
			call(one.PATCH, { params: { id }, request: req('PATCH', { title: 'y' }) }, false)
		).rejects.toBeDefined();
		await expect(call(one.DELETE, { params: { id } }, false)).rejects.toBeDefined();
		await call(one.DELETE, { params: { id } });
	});
});
