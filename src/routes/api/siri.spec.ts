import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'hub-siri-api-'));

const { getDb, schema } = await import('#lib/server/db/index.js');
const tokens = await import('./api-tokens/+server.js');
const siriLists = await import('./siri/lists/+server.js');
const siriItem = await import('./siri/list-item/+server.js');
const siriJob = await import('./siri/star-job/+server.js');
const lists = await import('./lists/+server.js');
const choresApi = await import('./chores/+server.js');
const { siriLimiter } = await import('#lib/server/siri.js');
const { listAll } = await import('#lib/server/domain/lists.js');

const adult = { id: 'adult', name: 'Test Adult' };
const post = (body: unknown, auth?: string) =>
	new Request('http://example.com/x', {
		method: 'POST',
		headers: auth ? { authorization: `Bearer ${auth}` } : {},
		body: typeof body === 'string' ? body : JSON.stringify(body)
	});
const get = (auth?: string) =>
	new Request('http://example.com/x', { headers: auth ? { authorization: `Bearer ${auth}` } : {} });
const call = async (h: unknown, ev: Record<string, unknown>) => {
	try {
		return await (h as (e: unknown) => Promise<Response> | Response)({
			locals: { adult: null },
			...ev
		});
	} catch (e) {
		const err = e as { status?: number };
		if (err.status) return new Response(null, { status: err.status });
		throw e;
	}
};
async function mint(name: string, scopes: string[]) {
	const res = await call(tokens.POST, {
		locals: { adult },
		request: post({ name, scopes })
	});
	expect(res.status).toBe(201);
	return (await res.json()) as { id: string; token: string };
}

describe('bearer auth', () => {
	it('rejects missing, malformed and unknown tokens with a spoken 401', async () => {
		for (const auth of [undefined, 'short', 'a'.repeat(43)]) {
			const res = await call(siriLists.GET, { request: get(auth) });
			expect(res.status).toBe(401);
			expect((await res.json()).speak).toBeTruthy();
		}
	});

	it('enforces scopes with 403', async () => {
		const t = await mint('Lists only', ['lists:add']);
		const res = await call(siriJob.POST, { request: post({ title: 'Feed the cat' }, t.token) });
		expect(res.status).toBe(403);
		expect((await res.json()).ok).toBe(false);
	});

	it('is accepted only by the siri routes: other APIs ignore it and sessions are not created', async () => {
		const t = await mint('Everything', ['lists:add', 'chores:create']);
		const res = await call(choresApi.POST, { request: post({ title: 'Sneaky' }, t.token) });
		expect(res.status).toBe(401);
		const sirires = await call(siriLists.GET, { request: get(t.token) });
		expect(sirires.headers.get('set-cookie')).toBeNull();
	});

	it('stamps last use', async () => {
		const t = await mint('Stamp', ['lists:add']);
		const before = await (await call(tokens.GET, { locals: { adult } })).json();
		expect(before.find((x: { id: string }) => x.id === t.id).lastUsedAt).toBeNull();
		await call(siriLists.GET, { request: get(t.token) });
		const after = await (await call(tokens.GET, { locals: { adult } })).json();
		expect(after.find((x: { id: string }) => x.id === t.id).lastUsedAt).toBeGreaterThan(0);
	});

	it('rate limits per token with a spoken 429', async () => {
		const a = await mint('Busy', ['lists:add']);
		const b = await mint('Calm', ['lists:add']);
		let last = 200;
		for (let i = 0; i < 31; i++)
			last = (await call(siriLists.GET, { request: get(a.token) })).status;
		expect(last).toBe(429);
		expect((await call(siriLists.GET, { request: get(b.token) })).status).toBe(200);
		siriLimiter.take('noop');
	});
});

describe('POST /api/siri/list-item', () => {
	it('adds to a loosely matched list', async () => {
		const t = await mint('Adder', ['lists:add']);
		const res = await call(siriItem.POST, {
			request: post({ list: 'groceries', item: '  Milk ' }, t.token)
		});
		const body = await res.json();
		expect(body).toMatchObject({ ok: true, list: 'Grocery', item: 'Milk' });
		expect(body.speak).toContain('Milk');
		const shown = await (await call(lists.GET, {})).json();
		expect(shown[0].items.map((i: { text: string }) => i.text)).toContain('Milk');
	});

	it('names the lists when unknown, and validates input', async () => {
		const t = await mint('Adder2', ['lists:add']);
		const miss = await (
			await call(siriItem.POST, { request: post({ list: 'garage', item: 'Hammer' }, t.token) })
		).json();
		expect(miss.ok).toBe(false);
		expect(miss.speak).toContain('Grocery');
		expect(miss.lists).toEqual(listAll(getDb()).map((l) => l.title));
		for (const body of [
			{ list: 'grocery', item: '   ' },
			{ list: 'grocery', item: 'x'.repeat(121) },
			{ list: 'grocery' }
		])
			expect((await call(siriItem.POST, { request: post(body, t.token) })).status).toBe(400);
		expect((await call(siriItem.POST, { request: post('not json', t.token) })).status).toBe(400);
	});
});

describe('GET /api/siri/lists', () => {
	it('returns the names', async () => {
		const t = await mint('Lister', ['lists:add']);
		const body = await (await call(siriLists.GET, { request: get(t.token) })).json();
		expect(body.lists).toEqual(['Grocery', 'To-Do', 'Packing']);
		expect(body.speak).toContain('Grocery');
	});
});

describe('POST /api/siri/star-job', () => {
	const addKid = (id: string, name: string) =>
		getDb().insert(schema.members).values({ id, name, role: 'child', color: 'member-2' }).run();

	it('defaults to the only kid, one star, and approval follows the household default (off)', async () => {
		const t = await mint('Jobber', ['chores:create']);
		addKid('siri-kid-1', 'Zed');
		const body = await (
			await call(siriJob.POST, { request: post({ title: ' Feed the cat ' }, t.token) })
		).json();
		expect(body).toMatchObject({ ok: true, stars: 1 });
		expect(body.speak).toBe('Added a 1-star job, Feed the cat, for Zed.');
		const chore = (
			await (await call(choresApi.GET, { url: new URL('http://x/?kind=star_job') })).json()
		).find((c: { id: string }) => c.id === body.id);
		expect(chore).toMatchObject({ memberIds: ['siri-kid-1'], requiresApproval: false });
		expect(chore.schedule.type).toBe('once');
	});

	it('needs a kid when there are several, and matches names by prefix', async () => {
		const t = await mint('Jobber2', ['chores:create']);
		addKid('siri-kid-2', 'Zora');
		const ask = await (
			await call(siriJob.POST, { request: post({ title: 'Tidy room' }, t.token) })
		).json();
		expect(ask.ok).toBe(false);
		expect(ask.kids).toEqual(expect.arrayContaining(['Zed', 'Zora']));
		const amb = await (
			await call(siriJob.POST, { request: post({ title: 'Tidy room', kid: 'z' }, t.token) })
		).json();
		expect(amb.ok).toBe(false);
		const unknown = await (
			await call(siriJob.POST, { request: post({ title: 'Tidy room', kid: 'Nobody' }, t.token) })
		).json();
		expect(unknown.ok).toBe(false);
		const ok = await (
			await call(siriJob.POST, {
				request: post({ title: 'Tidy room', kid: 'zo', stars: '3' }, t.token)
			})
		).json();
		expect(ok.speak).toBe('Added a 3-star job, Tidy room, for Zora.');
	});

	it('validates title and stars', async () => {
		const t = await mint('Jobber3', ['chores:create']);
		for (const body of [
			{ title: '' },
			{ title: 'x'.repeat(61) },
			{ title: 'Ok', stars: 6 },
			{ title: 'Ok', stars: 0 },
			{ title: 'Ok', stars: 1.5 }
		])
			expect((await call(siriJob.POST, { request: post(body, t.token) })).status).toBe(400);
	});
});
