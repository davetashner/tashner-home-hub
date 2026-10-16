import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '#lib/server/db/index.js';
import { calendarSources, events, members } from '#lib/server/db/schema.js';

process.env.HUB_SECRET_KEY = randomBytes(32).toString('base64');
process.env.HUB_GOOGLE_CLIENT_ID = 'test-client-id.apps.example';
process.env.HUB_GOOGLE_CLIENT_SECRET = 'test-client-secret-xyz';

let db: Db;
vi.mock('#lib/server/db/index.js', async (orig) => ({
	...(await orig<typeof import('#lib/server/db/index.js')>()),
	getDb: () => db
}));

const one = await import('./sources/[id]/+server.js');
const google = await import('#lib/server/calendar/google.js');
const { getKeyring } = await import('#lib/server/keys.js');
const { runSync, readStatuses } = await import('#lib/server/calendar/sync.js');
const { listSources } = await import('#lib/server/calendar/sources.js');

const REFRESH = 'refresh_token_SECRET_1';
const ACCESS = 'access_token_SECRET_1';
let revoked = false;
const hits = { token: 0, events: 0 };
let tokenBodies: URLSearchParams[] = [];

const EVENTS_P1 = {
	items: [
		{
			id: 'm1',
			summary: 'Soccer',
			start: { dateTime: '2099-01-05T17:00:00-05:00', timeZone: 'America/New_York' },
			end: { dateTime: '2099-01-05T18:00:00-05:00', timeZone: 'America/New_York' },
			recurrence: ['RRULE:FREQ=WEEKLY;COUNT=4']
		},
		{ id: 'allday', summary: 'Holiday', start: { date: '2099-01-02' }, end: { date: '2099-01-03' } }
	],
	nextPageToken: 'p2'
};
const EVENTS_P2 = {
	items: [
		{
			id: 'm1_o',
			recurringEventId: 'm1',
			originalStartTime: { dateTime: '2099-01-12T17:00:00-05:00', timeZone: 'America/New_York' },
			summary: 'Soccer (moved)',
			start: { dateTime: '2099-01-12T19:00:00-05:00', timeZone: 'America/New_York' },
			end: { dateTime: '2099-01-12T20:00:00-05:00', timeZone: 'America/New_York' }
		},
		{
			id: 'm1_c',
			status: 'cancelled',
			recurringEventId: 'm1',
			originalStartTime: { dateTime: '2099-01-19T17:00:00-05:00', timeZone: 'America/New_York' }
		}
	]
};

let server: Server;
beforeAll(async () => {
	server = createServer((req, res) => {
		const url = new URL(req.url!, 'http://x');
		let raw = '';
		req.on('data', (c) => (raw += c));
		req.on('end', () => {
			const send = (code: number, body: unknown) =>
				res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(body));
			if (url.pathname === '/token') {
				hits.token++;
				const p = new URLSearchParams(raw);
				tokenBodies.push(p);
				if (p.get('grant_type') === 'authorization_code')
					return p.get('code') === 'good-code' && p.get('code_verifier')
						? send(200, { access_token: ACCESS, refresh_token: REFRESH, expires_in: 3600 })
						: p.get('code') === 'no-refresh'
							? send(200, { access_token: ACCESS, expires_in: 3600 })
							: send(400, { error: 'invalid_grant' });
				if (revoked || p.get('refresh_token') !== REFRESH)
					return send(400, { error: 'invalid_grant', error_description: REFRESH });
				return send(200, { access_token: ACCESS, expires_in: 3600 });
			}
			if (req.headers.authorization !== `Bearer ${ACCESS}`) return send(401, {});
			if (url.pathname === '/cal/users/me/calendarList')
				return send(200, {
					items: [
						{ id: 'primary@example.com', summary: 'Main', primary: true },
						{ id: 'shared@example.com', summary: 'Shared', summaryOverride: 'Team' }
					]
				});
			const m = /^\/cal\/calendars\/([^/]+)\/events$/.exec(url.pathname);
			if (m) {
				hits.events++;
				if (decodeURIComponent(m[1]!) === 'secret@example.com') return send(404, {});
				expect(url.searchParams.get('singleEvents')).toBe('false');
				return send(200, url.searchParams.get('pageToken') === 'p2' ? EVENTS_P2 : EVENTS_P1);
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

const adult = { adult: { id: 'a', name: 'A' } };
async function connect() {
	const id = randomUUID();
	db.insert(calendarSources)
		.values({
			id,
			provider: 'google',
			label: 'Mom',
			credentials: google.sealRefreshToken(getKeyring(), id, REFRESH),
			calendars: JSON.stringify([
				{ externalId: 'primary@example.com', name: 'Main', memberId: null },
				{ externalId: 'shared@example.com', name: 'Team', memberId: null, selected: false }
			])
		})
		.run();
	return id;
}

beforeEach(() => {
	db = openDb(':memory:');
	db.insert(members).values({ id: 'm1', name: 'Kid', role: 'child', color: '#fff' }).run();
	revoked = false;
	hits.token = hits.events = 0;
	tokenBodies = [];
});

describe('sync', () => {
	async function connected() {
		const id = await connect();
		await one.PATCH({
			locals: adult,
			params: { id },
			request: new Request('http://x', {
				method: 'PATCH',
				body: JSON.stringify({
					calendars: [{ externalId: 'primary@example.com', memberId: 'm1' }]
				})
			})
		} as never);
		return id as string;
	}

	it('syncs paged events: recurrence, override, cancelled and all-day', async () => {
		const id = await connected();
		const st = (await runSync(db, { now: () => Date.parse('2098-12-20T00:00:00Z') }))[id]!;
		expect(st.lastError).toBeNull();
		expect(hits.events).toBe(2);
		const rows = db.select().from(events).all();
		const titles = rows.map((r) => `${r.title}@${new Date(r.startsAt).toISOString()}`).sort();
		expect(titles).toEqual([
			'Holiday@2099-01-02T00:00:00.000Z',
			'Soccer (moved)@2099-01-13T00:00:00.000Z',
			'Soccer@2099-01-05T22:00:00.000Z',
			'Soccer@2099-01-26T22:00:00.000Z'
		]);
		expect(rows.find((r) => r.title === 'Holiday')!.allDay).toBe(true);
		expect(rows.every((r) => r.memberIds === '["m1"]')).toBe(true);
	});

	it('does not fetch deselected calendars', async () => {
		const id = await connected();
		await one.PATCH({
			locals: adult,
			params: { id },
			request: new Request('http://x', {
				method: 'PATCH',
				body: JSON.stringify({
					calendars: [{ externalId: 'primary@example.com', selected: false }]
				})
			})
		} as never);
		await runSync(db);
		expect(hits.events).toBe(0);
	});

	it('reuses the access token across calendars', async () => {
		const id = await connected();
		const prov = google.createGoogleProvider(
			(await import('#lib/server/calendar/sources.js')).getSource(db, id)!
		);
		const before = hits.token;
		await prov.listCalendars();
		await prov.fetchEvents('primary@example.com', { start: 0, end: 1e12 });
		expect(hits.token - before).toBe(1);
	});

	it('flags invalid_grant as needing re-auth without leaking secrets', async () => {
		const id = await connected();
		revoked = true;
		const st = (await runSync(db))[id]!;
		expect(st.lastError).toContain('needs to be reconnected');
		expect(st.needsReauth).toBe(true);
		const view = listSources(db).find((v) => v.id === id)!;
		expect(view.needsReauth).toBe(true);
		const all = JSON.stringify([st, view, readStatuses(db)]);
		for (const secret of [REFRESH, ACCESS, 'test-client-secret-xyz'])
			expect(all).not.toContain(secret);
	});

	it('reports calendar access errors per calendar', async () => {
		const id = await connected();
		db.update(calendarSources)
			.set({
				calendars: JSON.stringify([{ externalId: 'secret@example.com', name: 'x', memberId: null }])
			})
			.run();
		const st = (await runSync(db))[id]!;
		expect(st.lastError).toContain('denied access');
		expect(listSources(db)[0]!.needsReauth).toBe(false);
	});

	it('explains missing client config during sync', async () => {
		const id = await connected();
		const sec = process.env.HUB_GOOGLE_CLIENT_SECRET;
		delete process.env.HUB_GOOGLE_CLIENT_SECRET;
		const st = (await runSync(db))[id]!;
		process.env.HUB_GOOGLE_CLIENT_SECRET = sec;
		expect(st.lastError).toContain('HUB_GOOGLE_CLIENT_SECRET');
	});
});
