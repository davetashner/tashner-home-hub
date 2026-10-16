import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '#lib/server/db/index.js';
import { calendarSources, events, members, settings } from '#lib/server/db/schema.js';

process.env.HUB_SECRET_KEY = randomBytes(32).toString('base64');

let db: Db;
vi.mock('#lib/server/db/index.js', async (orig) => ({
	...(await orig<typeof import('#lib/server/db/index.js')>()),
	getDb: () => db
}));

const list = await import('./sources/+server.js');
const one = await import('./sources/[id]/+server.js');
const { runSync } = await import('#lib/server/calendar/sync.js');
const eventsApi = await import('./events/+server.js');

const FEED = `BEGIN:VCALENDAR
VERSION:2.0
X-WR-CALNAME:Test Cal
BEGIN:VEVENT
UID:a@example.com
SUMMARY:Picture day
DTSTART;VALUE=DATE:20260901
END:VEVENT
END:VCALENDAR
`;
const SECRET = 'tok_super_secret_123';

let server: Server;
let base: string;
beforeAll(async () => {
	server = createServer((req, res) => {
		if (req.url?.startsWith('/feed.ics')) res.writeHead(200).end(FEED);
		else if (req.url === '/html') res.writeHead(200).end('<html></html>');
		else res.writeHead(404).end();
	});
	await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
	server.closeAllConnections();
	server.close();
});

const adult = { adult: { id: 'a', name: 'A' } };
const req = (body: unknown, locals: unknown = adult, params = {}) =>
	({
		locals,
		params,
		request: new Request('http://x/api/calendar/sources', {
			method: 'POST',
			body: JSON.stringify(body)
		})
	}) as never;
const ev = (locals: unknown = adult, params = {}) => ({ locals, params }) as never;

async function statusOf(f: () => unknown) {
	try {
		await f();
	} catch (e) {
		return (e as { status: number; body?: { message: string } }).status;
	}
}
async function messageOf(f: () => unknown) {
	try {
		await f();
	} catch (e) {
		return (e as { body: { message: string } }).body.message;
	}
}

beforeEach(() => {
	db = openDb(':memory:');
	db.insert(members).values({ id: 'm1', name: 'Kid', role: 'child', color: '#fff' }).run();
});

async function create(extra: object = {}) {
	const res = await list.POST(
		req({ provider: 'ics', label: 'School', url: `${base}/feed.ics?t=${SECRET}`, ...extra })
	);
	return { res, body: await res.json() };
}

describe('calendar sources API', () => {
	it('requires an adult everywhere', async () => {
		const none = { adult: null };
		expect(await statusOf(() => list.GET(ev(none)))).toBe(401);
		expect(await statusOf(() => list.POST(req({}, none)))).toBe(401);
		expect(await statusOf(() => one.PATCH(req({}, none, { id: 'x' })))).toBe(401);
		expect(await statusOf(() => one.DELETE(ev(none, { id: 'x' })))).toBe(401);
	});

	it('creates a source, encrypts the URL and never returns it', async () => {
		const { res, body } = await create({ memberId: 'm1' });
		expect(res.status).toBe(201);
		expect(body).toMatchObject({
			provider: 'ics',
			label: 'School',
			host: new URL(base).host,
			calendars: [{ name: 'Test Cal', memberId: 'm1' }],
			events: 1
		});
		const row = db.select().from(calendarSources).get()!;
		expect(row.credentials).not.toContain(SECRET);
		expect(JSON.stringify(body)).not.toContain(SECRET);
		const listed = JSON.stringify(await (await list.GET(ev())).json());
		expect(listed).not.toContain(SECRET);
		expect(listed).not.toContain('feed.ics');
		expect(listed).toContain(new URL(base).host);
	});

	it('rejects bad input with friendly 400s', async () => {
		expect(await statusOf(() => list.POST(req({ provider: 'google' })))).toBe(400);
		expect(await statusOf(() => list.POST(req({ provider: 'ics', label: 'L' })))).toBe(400);
		expect(
			await statusOf(() =>
				list.POST(req({ provider: 'ics', label: 'L', url: 'x:y', memberId: 'zz' }))
			)
		).toBe(400);
		expect(
			await messageOf(() =>
				list.POST(req({ provider: 'ics', label: 'L', url: 'ftp://example.com/a' }))
			)
		).toMatch(/must start with/);
		expect(
			await messageOf(() => list.POST(req({ provider: 'ics', label: 'L', url: `${base}/html` })))
		).toMatch(/not a valid|not an iCalendar/);
		expect(
			await messageOf(() => list.POST(req({ provider: 'ics', label: 'L', url: `${base}/nope` })))
		).toMatch(/404/);
		expect(db.select().from(calendarSources).all()).toHaveLength(0);
	});

	it('syncs a created source end to end into the events API', async () => {
		await create();
		const out = await runSync(db, { now: () => Date.parse('2026-08-20') });
		expect(Object.values(out)[0]!.lastError).toBeNull();
		const res = await eventsApi.GET({
			url: new URL('http://x/api/calendar/events?start=2026-08-25&end=2026-09-10')
		} as never);
		expect((await res.json()).map((e: { title: string }) => e.title)).toEqual(['Picture day']);
	});

	it('PATCH relabels and maps members; unknown members and empty bodies are 400', async () => {
		const id = (await create()).body.id as string;
		const patch = (body: unknown) => one.PATCH(req(body, adult, { id }));
		expect((await (await patch({ label: 'Renamed' })).json()).label).toBe('Renamed');
		expect((await (await patch({ memberId: 'm1' })).json()).calendars[0].memberId).toBe('m1');
		expect((await (await patch({ memberId: null })).json()).calendars[0].memberId).toBeNull();
		const ext = (await (await patch({ label: 'Renamed' })).json()).calendars[0].externalId;
		const byCal = await (await patch({ calendars: [{ externalId: ext, memberId: 'm1' }] })).json();
		expect(byCal.calendars[0].memberId).toBe('m1');
		expect(await statusOf(() => patch({ memberId: 'nope' }))).toBe(400);
		expect(await statusOf(() => patch({}))).toBe(400);
		expect(await statusOf(() => one.PATCH(req({ label: 'x' }, adult, { id: 'missing' })))).toBe(
			404
		);
	});

	it('DELETE removes the source, its events and its cache', async () => {
		const id = (await create()).body.id as string;
		await runSync(db, { now: () => Date.parse('2026-08-20') });
		expect(db.select().from(events).all().length).toBe(1);
		expect(
			db
				.select()
				.from(settings)
				.all()
				.some((s) => s.key.includes(id))
		).toBe(true);
		expect((await one.DELETE(ev(adult, { id }))).status).toBe(204);
		expect(db.select().from(events).all()).toHaveLength(0);
		expect(
			db
				.select()
				.from(settings)
				.all()
				.some((s) => s.key.endsWith(id))
		).toBe(false);
		expect(await statusOf(() => one.DELETE(ev(adult, { id })))).toBe(404);
	});

	it('lists non-ICS sources without a host', async () => {
		db.insert(calendarSources).values({ id: 'g', provider: 'google', label: 'G' }).run();
		db.insert(calendarSources)
			.values({ id: 'bad', provider: 'ics', label: 'B', credentials: 'junk' })
			.run();
		const rows = await (await list.GET(ev())).json();
		expect(rows.map((r: { host: unknown }) => r.host)).toEqual([null, null]);
	});
});
