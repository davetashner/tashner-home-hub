import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '#lib/server/db/index.js';
import { allowanceTransactions, members } from '#lib/server/db/schema.js';

let db: Db;
vi.mock('#lib/server/db/index.js', async (orig) => ({
	...(await orig<typeof import('#lib/server/db/index.js')>()),
	getDb: () => db
}));

const col = await import('./+server.js');
const item = await import('./[goalId]/+server.js');
const current = await import('./[goalId]/current/+server.js');
const bought = await import('./[goalId]/bought/+server.js');

const ev = (init: { body?: unknown; params?: Record<string, string>; adult?: boolean } = {}) =>
	({
		request: new Request('http://x/api', {
			method: 'POST',
			body: init.body === undefined ? undefined : JSON.stringify(init.body)
		}),
		params: { id: 'kid', ...init.params },
		url: new URL('http://x/api'),
		locals: { adult: init.adult ? { id: 'adult', name: 'Test Adult' } : null }
	}) as never;

async function status(f: () => Promise<Response> | Response) {
	try {
		return (await f()).status;
	} catch (e) {
		return (e as { status: number }).status;
	}
}

async function make(title = 'Bike', targetCents = 5000) {
	const res = await col.POST(ev({ body: { title, targetCents, emoji: '🚲' } }));
	expect(res.status).toBe(201);
	return (await res.json()) as { id: string };
}

beforeEach(() => {
	db = openDb(':memory:');
	db.insert(members).values({ id: 'kid', name: 'Kid One', role: 'child', color: 'member-1' }).run();
});

describe('savings goals API', () => {
	it('lets a kid create, list, edit, set current and archive without a PIN', async () => {
		const a = await make('Bike');
		const b = await make('Lego', 2000);
		const list = await (await col.GET(ev())).json();
		expect(list).toMatchObject({ balanceCents: 0 });
		expect(list.goals).toHaveLength(2);

		const edited = await item.PATCH(ev({ params: { goalId: b.id }, body: { title: 'Big Lego' } }));
		expect((await edited.json()).title).toBe('Big Lego');
		const cur = await current.PUT(ev({ params: { goalId: b.id } }));
		expect((await cur.json()).current).toBe(true);
		const del = await item.DELETE(ev({ params: { goalId: a.id } }));
		expect(await del.json()).toEqual({ id: a.id });
		expect((await (await col.GET(ev())).json()).goals).toHaveLength(1);
	});

	it('returns 400 for bad input and 404 for unknown member or goal', async () => {
		expect(await status(() => col.POST(ev({ body: { title: 'x', targetCents: 5 } })))).toBe(400);
		expect(await status(() => col.POST(ev({ body: [1] })))).toBe(400);
		expect(await status(() => col.GET(ev({ params: { id: 'nobody' } })))).toBe(404);
		expect(await status(() => item.PATCH(ev({ params: { goalId: 'nope' }, body: {} })))).toBe(404);
		expect(await status(() => current.PUT(ev({ params: { goalId: 'nope' } })))).toBe(404);
	});

	it('marks bought only for an adult, and only with enough saved', async () => {
		const g = await make('Bike', 5000);
		expect(await status(() => bought.POST(ev({ params: { goalId: g.id } })))).toBe(401);
		expect(await status(() => bought.POST(ev({ adult: true, params: { goalId: g.id } })))).toBe(
			409
		);
		db.insert(allowanceTransactions)
			.values({ id: 't1', memberId: 'kid', cents: 6000, kind: 'adjustment', note: 'seed' })
			.run();
		const res = await bought.POST(ev({ adult: true, params: { goalId: g.id } }));
		const body = await res.json();
		expect(body.balanceCents).toBe(1000);
		expect(body.goal).toMatchObject({ status: 'bought', savedCents: 5000 });
	});
});
