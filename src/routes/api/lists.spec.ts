import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'hub-lists-api-'));

const root = await import('./lists/+server.js');
const one = await import('./lists/[id]/+server.js');
const items = await import('./lists/[id]/items/+server.js');
const clear = await import('./lists/[id]/clear/+server.js');
const item = await import('./list-items/[id]/+server.js');

const req = (method: string, body?: unknown) =>
	new Request('http://example.com/x', {
		method,
		body: body === undefined ? undefined : JSON.stringify(body)
	});
const call = async (h: unknown, ev: Record<string, unknown>, adult = false) =>
	(h as (e: unknown) => Promise<Response> | Response)({
		locals: { adult: adult ? { id: 'adult', name: 'Test Adult' } : null },
		...ev
	});

describe('lists API', () => {
	it('seeds the defaults, then adds, checks, deletes and clears', async () => {
		const seeded = await (await call(root.GET, {})).json();
		expect(seeded.map((l: { title: string }) => l.title)).toEqual(['Grocery', 'To-Do', 'Packing']);
		const params = { id: seeded[0].id };

		const a = await (
			await call(items.POST, { params, request: req('POST', { text: ' Milk ' }) })
		).json();
		const b = await (
			await call(items.POST, { params, request: req('POST', { text: 'Eggs' }) })
		).json();
		expect(a.text).toBe('Milk');

		const checkedA = await call(item.POST, {
			params: { id: a.id },
			request: req('POST', { done: true })
		});
		expect(checkedA.status).toBe(200);
		const after = (await (await call(root.GET, {})).json())[0].items;
		expect(after.map((i: { text: string }) => i.text)).toEqual(['Eggs', 'Milk']);

		expect((await call(clear.POST, { params, request: req('POST', {}) })).status).toBe(200);
		expect((await (await call(root.GET, {})).json())[0].items).toHaveLength(1);

		expect((await call(item.DELETE, { params: { id: b.id } })).status).toBe(200);
		expect((await call(item.DELETE, { params: { id: b.id } })).status).toBe(200);
		expect((await (await call(root.GET, {})).json())[0].items).toHaveLength(0);
	});

	it('rejects bad input', async () => {
		const [first] = await (await call(root.GET, {})).json();
		const fails = (h: unknown, params: object, body: unknown, status: number) =>
			expect(call(h, { params, request: req('POST', body) })).rejects.toMatchObject({ status });
		await fails(items.POST, { id: first.id }, { text: '  ' }, 400);
		await fails(items.POST, { id: 'nope' }, { text: 'x' }, 404);
		await fails(item.POST, { id: 'nope' }, { done: true }, 404);
		await fails(item.POST, { id: 'nope' }, { done: 'yes' }, 400);
		await fails(root.POST, {}, { title: '' }, 400);
	});

	it('lets anyone create a list but only an adult delete one', async () => {
		const res = await call(root.POST, { request: req('POST', { title: 'Camping' }) });
		expect(res.status).toBe(201);
		const { id } = await res.json();
		await expect(call(one.DELETE, { params: { id } })).rejects.toMatchObject({ status: 401 });
		expect((await call(one.DELETE, { params: { id } }, true)).status).toBe(200);
		await expect(call(one.DELETE, { params: { id } }, true)).rejects.toMatchObject({ status: 404 });
	});
});
