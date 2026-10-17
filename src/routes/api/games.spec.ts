import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'hub-games-api-'));

const list = await import('./games/+server.js');
const one = await import('./games/[id]/+server.js');

/** The hub's own origin, as SvelteKit gives it on `event.url`. */
const HUB = 'https://hub.example.com/api/games';
const req = (method: string, body?: unknown) =>
	new Request('http://example.com/x', {
		method,
		body: body === undefined ? undefined : JSON.stringify(body)
	});
const call = async (h: unknown, ev: Record<string, unknown>, adult = true) =>
	(h as (e: unknown) => Promise<Response> | Response)({
		locals: { adult: adult ? { id: 'adult', name: 'Test Adult' } : null },
		url: new URL(HUB),
		...ev
	});
const create = async (title: string) =>
	(
		await call(list.POST, {
			request: req('POST', { title, url: `https://games.example.com/${title}/index.html` })
		})
	).json();
const titles = async () =>
	((await (await call(list.GET, {}, false)).json()) as { title: string }[]).map((g) => g.title);

describe('games API', () => {
	it('creates, lists in order, edits, reorders and deletes', async () => {
		expect(await titles()).toEqual([]);
		const a = await create('alpha');
		const b = await create('beta');
		await create('gamma');
		expect(await titles()).toEqual(['alpha', 'beta', 'gamma']);

		const patched = await (
			await call(one.PATCH, {
				params: { id: a.id },
				request: req('PATCH', { title: ' Alpha 2 ', image: 'https://img.example.com/a.png' })
			})
		).json();
		expect(patched).toMatchObject({ title: 'Alpha 2', image: 'https://img.example.com/a.png' });

		await call(one.PATCH, { params: { id: b.id }, request: req('PATCH', { move: -1 }) });
		expect(await titles()).toEqual(['beta', 'Alpha 2', 'gamma']);

		expect((await call(one.DELETE, { params: { id: a.id } })).status).toBe(200);
		expect(await titles()).toEqual(['beta', 'gamma']);
	});

	it("refuses a game on the hub's own origin, on create and edit (hub-wzg review)", async () => {
		await expect(
			call(list.POST, { request: req('POST', { title: 'x', url: 'https://hub.example.com/' }) })
		).rejects.toMatchObject({ status: 400 });
		const g = await create('delta');
		await expect(
			call(one.PATCH, {
				params: { id: g.id },
				request: req('PATCH', { url: 'https://hub.example.com/settings' })
			})
		).rejects.toMatchObject({ status: 400 });
		await call(one.DELETE, { params: { id: g.id } });
	});

	it('rejects bad input, missing rows and a full list', async () => {
		await expect(
			call(list.POST, { request: req('POST', { title: 'x', url: 'http://games.example.com/' }) })
		).rejects.toMatchObject({ status: 400 });
		await expect(
			call(one.PATCH, { params: { id: 'nope' }, request: req('PATCH', { title: 'x' }) })
		).rejects.toMatchObject({ status: 404 });
		await expect(call(one.DELETE, { params: { id: 'nope' } })).rejects.toMatchObject({
			status: 404
		});
		const any = (await (await call(list.GET, {})).json())[0];
		await expect(
			call(one.PATCH, { params: { id: any.id }, request: req('PATCH', { move: 5 }) })
		).rejects.toMatchObject({ status: 400 });
		for (let i = 0; i < 30; i++) {
			const res = await call(list.POST, {
				request: req('POST', { title: `g${i}`, url: 'https://games.example.com/g/' })
			}).catch((e) => e);
			if (res.status === 400) break;
		}
		expect((await titles()).length).toBe(24);
	});

	it('needs an adult to change anything', async () => {
		const body = { title: 'x', url: 'https://games.example.com/x/' };
		await expect(call(list.POST, { request: req('POST', body) }, false)).rejects.toBeDefined();
		await expect(
			call(one.PATCH, { params: { id: 'x' }, request: req('PATCH', {}) }, false)
		).rejects.toBeDefined();
		await expect(call(one.DELETE, { params: { id: 'x' } }, false)).rejects.toBeDefined();
	});
});
