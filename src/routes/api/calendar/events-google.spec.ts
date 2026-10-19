import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOUSEHOLD_TZ_KEY } from '#lib/domain/time-zone.js';
import { openDb, type Db } from '#lib/server/db/index.js';
import { calendarSources, events, settings } from '#lib/server/db/schema.js';
import { scopedId } from '#lib/server/domain/calendar/diff.js';

process.env.HUB_SECRET_KEY = randomBytes(32).toString('base64');
process.env.HUB_GOOGLE_CLIENT_ID = 'test-client-id.apps.example';
process.env.HUB_GOOGLE_CLIENT_SECRET = 'test-client-secret-xyz';

let db: Db;
vi.mock('#lib/server/db/index.js', async (orig) => ({
	...(await orig<typeof import('#lib/server/db/index.js')>()),
	getDb: () => db
}));

const createRoute = await import('./events/+server.js');
const itemRoute = await import('./events/[id]/+server.js');
const google = await import('#lib/server/calendar/google.js');
const { listSources } = await import('#lib/server/calendar/sources.js');
const { getKeyring } = await import('#lib/server/keys.js');

const REFRESH = 'refresh_token_SECRET_1';
const ACCESS = 'access_token_SECRET_1';
const CAL = 'team@example.com';
const START = Date.UTC(2026, 9, 20, 21, 0);
const adult = { adult: { id: 'a', name: 'A' } };

interface Stored {
	id: string;
	etag: string;
	summary: string;
	location?: string;
	description?: string;
	start: { dateTime?: string; date?: string };
	end: { dateTime?: string; date?: string };
	recurrence?: string[];
}
// The fake Google calendar: one event store, plus a log of every write it received.
let store: Map<string, Stored>;
let writes: { method: string; path: string; ifMatch?: string; body: Record<string, unknown> }[];
let forbidden: 'insufficientPermissions' | 'other' | null;
let nextId = 1;

const timed = (id: string, extra: Partial<Stored> = {}): Stored => ({
	id,
	etag: '"e1"',
	summary: 'Old title',
	location: 'Old hall',
	start: { dateTime: new Date(START).toISOString() },
	end: { dateTime: new Date(START + 3_600_000).toISOString() },
	...extra
});

let server: Server;
beforeAll(async () => {
	server = createServer((req, res) => {
		const url = new URL(req.url!, 'http://x');
		let raw = '';
		req.on('data', (c) => (raw += c));
		req.on('end', () => {
			const send = (code: number, body: unknown) =>
				res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(body));
			if (url.pathname === '/token')
				return send(200, { access_token: ACCESS, expires_in: 3600, scope: 'x' });
			if (req.headers.authorization !== `Bearer ${ACCESS}`) return send(401, {});
			const list = /^\/cal\/calendars\/([^/]+)\/events$/.exec(url.pathname);
			const one = /^\/cal\/calendars\/([^/]+)\/events\/([^/]+)$/.exec(url.pathname);
			if (req.method !== 'GET') {
				writes.push({
					method: req.method!,
					path: decodeURIComponent(url.pathname),
					ifMatch: req.headers['if-match'] as string | undefined,
					body: raw ? JSON.parse(raw) : {}
				});
				if (forbidden === 'insufficientPermissions')
					return send(403, { error: { errors: [{ reason: 'insufficientPermissions' }] } });
				if (forbidden) return send(403, { error: { errors: [{ reason: 'forbidden' }] } });
			}
			if (list && req.method === 'POST') {
				const id = `g${nextId++}`;
				store.set(id, { ...(JSON.parse(raw) as Stored), id, etag: '"n1"' });
				return send(200, store.get(id));
			}
			if (list) return send(200, { items: [...store.values()] });
			if (one) {
				const id = decodeURIComponent(one[2]!);
				const cur = store.get(id);
				if (!cur) return send(404, {});
				if (req.method === 'GET') return send(200, cur);
				if (req.headers['if-match'] !== cur.etag) return send(412, {});
				if (req.method === 'DELETE') {
					store.delete(id);
					return res.writeHead(204).end();
				}
				const patch = JSON.parse(raw) as Stored;
				store.set(id, { ...cur, ...patch, etag: '"e2"' });
				return send(200, store.get(id));
			}
			send(500, {});
		});
	});
	await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
	const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	google.endpoints.token = `${base}/token`;
	google.endpoints.api = `${base}/cal`;
});
afterAll(() => {
	server.closeAllConnections();
	server.close();
});

const outcome = async (f: () => unknown) => {
	try {
		await f();
	} catch (e) {
		return e as { status: number; body: { message: string } };
	}
};
const post = (body: unknown) =>
	createRoute.POST({
		locals: adult,
		request: new Request('http://x', { method: 'POST', body: JSON.stringify(body) })
	} as never);
const put = (id: string, body: unknown) =>
	itemRoute.PUT({
		locals: adult,
		params: { id },
		request: new Request('http://x', { method: 'PUT', body: JSON.stringify(body) })
	} as never);
const del = (id: string) => itemRoute.DELETE({ locals: adult, params: { id } } as never);

const valid = {
	calendarId: CAL,
	title: 'Piano recital',
	allDay: false,
	start: '2026-10-20T17:00',
	end: '2026-10-20T18:00',
	location: 'Hall'
};
const edit = { ...valid, title: 'New title', location: 'Old hall' };

function addSource(scope: string | undefined) {
	const id = randomUUID();
	db.insert(calendarSources)
		.values({
			id,
			provider: 'google',
			label: 'Parent One',
			credentials: google.sealRefreshToken(getKeyring(), id, REFRESH, scope),
			calendars: JSON.stringify([{ externalId: CAL, name: 'Team', memberId: null }])
		})
		.run();
	return id;
}
function addCached(sourceId: string, gid: string, over: Partial<typeof events.$inferInsert> = {}) {
	db.insert(events)
		.values({
			id: 'ev-1',
			sourceId,
			externalId: scopedId(CAL, `${gid}::${new Date(START).toISOString()}`),
			title: 'Old title',
			startsAt: START,
			endsAt: START + 3_600_000,
			location: 'Old hall',
			...over
		})
		.run();
}

beforeEach(() => {
	db = openDb(':memory:');
	db.insert(settings)
		.values({ key: HOUSEHOLD_TZ_KEY, value: JSON.stringify('America/New_York') })
		.run();
	store = new Map();
	writes = [];
	forbidden = null;
});

describe('scope detection', () => {
	it('asks for write access and lists calendars', () => {
		expect(google.SCOPE).toContain('auth/calendar.events');
		expect(google.SCOPE).toContain('calendarlist');
		expect(google.SCOPE).not.toContain('calendar.readonly');
	});
	it('only a stored write grant counts', () => {
		expect(google.hasWriteScope(`openid ${google.WRITE_SCOPE}`)).toBe(true);
		expect(google.hasWriteScope('https://www.googleapis.com/auth/calendar')).toBe(true);
		expect(google.hasWriteScope('https://www.googleapis.com/auth/calendar.readonly')).toBe(false);
		expect(google.hasWriteScope(undefined)).toBe(false);
	});
	it('the sources list tells old read-only connections to reconnect', () => {
		addSource(undefined);
		addSource(google.WRITE_SCOPE);
		const [old, fresh] = listSources(db);
		expect([old!.canWrite, old!.needsWriteReconnect]).toEqual([false, true]);
		expect([fresh!.canWrite, fresh!.needsWriteReconnect]).toEqual([true, false]);
	});
});

describe('Google write-back', () => {
	it('creates a timed event and returns the id Google assigned', async () => {
		addSource(google.WRITE_SCOPE);
		const res = await post(valid);
		expect(res.status).toBe(201);
		expect(writes).toHaveLength(1);
		expect(writes[0]).toMatchObject({ method: 'POST', path: `/cal/calendars/${CAL}/events` });
		expect(writes[0]!.body).toMatchObject({
			summary: 'Piano recital',
			location: 'Hall',
			start: { dateTime: '2026-10-20T21:00:00.000Z' },
			end: { dateTime: '2026-10-20T22:00:00.000Z' }
		});
	});

	it('creates an all-day event with an exclusive end date', async () => {
		addSource(google.WRITE_SCOPE);
		await post({
			calendarId: CAL,
			title: 'Field trip',
			allDay: true,
			start: '2026-10-21',
			end: '2026-10-22'
		});
		expect(writes[0]!.body).toMatchObject({
			start: { date: '2026-10-21' },
			end: { date: '2026-10-23' }
		});
	});

	it('refuses a write on an old read-only grant without calling Google', async () => {
		addSource(undefined);
		const err = await outcome(() => post(valid));
		expect(err?.status).toBe(403);
		expect(err?.body.message).toMatch(/Reconnect Google to add and edit events/);
		expect(writes).toHaveLength(0);
	});

	it('maps a 403 insufficientPermissions from Google to the reconnect message', async () => {
		addSource(google.WRITE_SCOPE);
		forbidden = 'insufficientPermissions';
		const err = await outcome(() => post(valid));
		expect(err?.status).toBe(403);
		expect(err?.body.message).toMatch(/Reconnect Google/);
	});

	it('shows a plain message when Google forbids that calendar for another reason', async () => {
		addSource(google.WRITE_SCOPE);
		forbidden = 'other';
		const err = await outcome(() => post(valid));
		expect(err?.status).toBe(502);
		expect(err?.body.message).toMatch(/does not let this account change/);
	});

	it('edits with If-Match, clears removed fields, then refetches', async () => {
		const sid = addSource(google.WRITE_SCOPE);
		store.set('abc', timed('abc'));
		addCached(sid, 'abc');
		expect((await put('ev-1', { ...edit, location: '' })).status).toBe(200);
		expect(writes[0]).toMatchObject({
			method: 'PATCH',
			path: `/cal/calendars/${CAL}/events/abc`,
			ifMatch: '"e1"'
		});
		expect(writes[0]!.body).toMatchObject({
			summary: 'New title',
			location: null,
			description: null,
			start: { dateTime: '2026-10-20T21:00:00.000Z', date: null }
		});
		expect(db.select().from(events).all()[0]!.title).toBe('New title');
	});

	it('is a conflict when Google differs from what the hub showed', async () => {
		const sid = addSource(google.WRITE_SCOPE);
		store.set('abc', timed('abc', { summary: 'Renamed on phone' }));
		addCached(sid, 'abc');
		const err = await outcome(() => put('ev-1', edit));
		expect(err?.status).toBe(409);
		expect(err?.body.message).toBe(google.CHANGED_MESSAGE);
		expect(writes).toHaveLength(0);
	});

	it('is a conflict when the event changes between the read and the write (412)', async () => {
		const sid = addSource(google.WRITE_SCOPE);
		store.set('abc', timed('abc'));
		addCached(sid, 'abc');
		const original = google.endpoints.api;
		// Another device edits the event right after our read: the etag we hold goes stale.
		const real = globalThis.fetch;
		const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
			const res = await real(input, init);
			if (!init?.method || init.method === 'GET') {
				const cur = store.get('abc');
				if (cur && String(input).includes('/events/abc'))
					store.set('abc', { ...cur, etag: '"moved"' });
			}
			return res;
		});
		const err = await outcome(() => put('ev-1', edit));
		spy.mockRestore();
		google.endpoints.api = original;
		expect(err?.status).toBe(409);
	});

	it('does not edit a repeating event', async () => {
		const sid = addSource(google.WRITE_SCOPE);
		store.set('abc', timed('abc', { recurrence: ['RRULE:FREQ=WEEKLY'] }));
		addCached(sid, 'abc');
		const err = await outcome(() => put('ev-1', edit));
		expect(err?.status).toBe(409);
		expect(err?.body.message).toBe(google.RECURRING_MESSAGE);
		expect(writes).toHaveLength(0);
	});

	it('deletes with If-Match and drops it from the cache', async () => {
		const sid = addSource(google.WRITE_SCOPE);
		store.set('abc', timed('abc'));
		addCached(sid, 'abc');
		expect((await del('ev-1')).status).toBe(200);
		expect(writes[0]).toMatchObject({ method: 'DELETE', ifMatch: '"e1"' });
		expect(store.has('abc')).toBe(false);
		expect(db.select().from(events).all()).toHaveLength(0);
	});

	it('refuses edit and delete on an old read-only grant', async () => {
		const sid = addSource(undefined);
		store.set('abc', timed('abc'));
		addCached(sid, 'abc');
		expect((await outcome(() => put('ev-1', edit)))?.status).toBe(403);
		expect((await outcome(() => del('ev-1')))?.status).toBe(403);
		expect(writes).toHaveLength(0);
	});
});
