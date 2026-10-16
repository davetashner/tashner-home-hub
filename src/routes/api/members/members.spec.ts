import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '#lib/server/db/index.js';

let db: Db;
vi.mock('#lib/server/db/index.js', async (orig) => ({
	...(await orig<typeof import('#lib/server/db/index.js')>()),
	getDb: () => db
}));

const { GET, POST } = await import('./+server.js');
const item = await import('./[id]/+server.js');

const ev = (init: { body?: unknown; params?: Record<string, string>; url?: string } = {}) =>
	({
		request: new Request('http://x/api/members', {
			method: 'POST',
			body: init.body === undefined ? undefined : JSON.stringify(init.body)
		}),
		params: init.params ?? {},
		url: new URL(init.url ?? 'http://x/api/members')
	}) as never;

async function status(f: () => Promise<Response> | Response | void) {
	try {
		return (await f())!.status;
	} catch (e) {
		return (e as { status: number }).status;
	}
}

beforeEach(() => {
	db = openDb(':memory:');
});

describe('members API', () => {
	it('creates then lists', async () => {
		const res = await POST(ev({ body: { name: 'Parent One', role: 'adult', color: 'member-1' } }));
		expect(res.status).toBe(201);
		const created = await res.json();
		const list = await (await GET(ev())).json();
		expect(list).toEqual([created]);
		expect(JSON.stringify(list)).not.toContain('pinHash');
	});

	it('rejects invalid input and non-object bodies', async () => {
		expect(
			await status(() => POST(ev({ body: { name: '', role: 'adult', color: 'member-1' } })))
		).toBe(400);
		expect(await status(() => POST(ev({ body: [1] })))).toBe(400);
		expect(await status(() => POST(ev()))).toBe(400);
	});

	it('gets, patches and deletes an item', async () => {
		const m = await (
			await POST(ev({ body: { name: 'A', role: 'adult', color: 'member-1' } }))
		).json();
		const kid = await (
			await POST(ev({ body: { name: 'K', role: 'child', color: 'member-2' } }))
		).json();
		const params = { id: kid.id };
		expect((await (await item.GET(ev({ params }))).json()).name).toBe('K');
		expect(await status(() => item.GET(ev({ params: { id: 'zzz' } })))).toBe(404);
		const patched = await (await item.PATCH(ev({ params, body: { name: 'Kay' } }))).json();
		expect(patched.name).toBe('Kay');
		expect(await status(() => item.DELETE(ev({ params })))).toBe(409);
		expect(await status(() => item.DELETE(ev({ params, url: 'http://x/?confirm=true' })))).toBe(
			204
		);
		expect(
			await status(() => item.DELETE(ev({ params: { id: m.id }, url: 'http://x/?confirm=true' })))
		).toBe(409);
	});
});
