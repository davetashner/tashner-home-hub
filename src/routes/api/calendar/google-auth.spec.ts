import { randomBytes } from 'node:crypto';
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

const start = await import('./google/start/+server.js');
const finish = await import('./google/finish/+server.js');
const one = await import('./sources/[id]/+server.js');
const google = await import('#lib/server/calendar/google.js');
const { parsePasted } = await import('#lib/server/calendar/google-connect.js');
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
const post = (body: unknown, locals: unknown = adult) =>
	({
		locals,
		params: {},
		request: new Request('http://x/api', { method: 'POST', body: JSON.stringify(body) })
	}) as never;

async function failure(f: () => unknown) {
	try {
		await f();
	} catch (e) {
		return e as { status: number; body: { message: string } };
	}
}

async function connect() {
	const s = await (start.POST(post({})) as Response).json();
	const res = (await finish.POST(
		post({ pasted: `http://127.0.0.1:9004/?state=${s.state}&code=good-code&scope=x`, label: 'Mom' })
	)) as Response;
	return { res, s };
}

beforeEach(() => {
	db = openDb(':memory:');
	db.insert(members).values({ id: 'm1', name: 'Kid', role: 'child', color: '#fff' }).run();
	revoked = false;
	hits.token = hits.events = 0;
	tokenBodies = [];
});

describe('consent flow', () => {
	it('requires an adult', async () => {
		expect((await failure(() => start.POST(post({}, {}))))?.status).toBe(401);
		expect((await failure(() => finish.POST(post({ pasted: 'x' }, {}))))?.status).toBe(401);
	});

	it('start builds a PKCE consent URL with the read-only scope', async () => {
		const s = await (start.POST(post({})) as Response).json();
		const u = new URL(s.url);
		expect(u.searchParams.get('scope')).toBe(google.SCOPE);
		expect(u.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:9004');
		expect(u.searchParams.get('code_challenge_method')).toBe('S256');
		expect(u.searchParams.get('access_type')).toBe('offline');
		expect(u.searchParams.get('state')).toBe(s.state);
		expect(s.url).not.toContain('test-client-secret');
	});

	it('start explains missing configuration', async () => {
		const id = process.env.HUB_GOOGLE_CLIENT_ID;
		delete process.env.HUB_GOOGLE_CLIENT_ID;
		const e = await failure(() => start.POST(post({})));
		process.env.HUB_GOOGLE_CLIENT_ID = id;
		expect(e?.status).toBe(400);
		expect(e?.body.message).toContain('HUB_GOOGLE_CLIENT_ID');
	});

	it('exchanges the pasted address, stores a sealed token and returns calendars', async () => {
		const { res } = await connect();
		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body.provider).toBe('google');
		expect(body.calendars).toEqual([
			{ externalId: 'primary@example.com', name: 'Main', memberId: null, selected: true },
			{ externalId: 'shared@example.com', name: 'Team', memberId: null, selected: false }
		]);
		expect(tokenBodies[0]!.get('code_verifier')).toBeTruthy();
		const json = JSON.stringify(body);
		for (const secret of [REFRESH, ACCESS, 'test-client-secret-xyz', 'good-code'])
			expect(json).not.toContain(secret);
		const stored = db.select().from(calendarSources).get()!;
		expect(stored.credentials).toBeTruthy();
		expect(stored.credentials).not.toContain(REFRESH);
	});

	it('rejects unknown state, bad pastes, denied consent and missing refresh tokens', async () => {
		const bad = async (pasted: string, state?: string) =>
			(await failure(() => finish.POST(post({ pasted, state }))))?.body.message;
		expect(await bad('http://127.0.0.1:9004/?code=good-code&state=nope')).toContain('expired');
		const s = await (start.POST(post({})) as Response).json();
		expect(await bad(`http://127.0.0.1:9004/?error=access_denied&state=${s.state}`)).toContain(
			'did not grant'
		);
		expect(await bad('http://127.0.0.1:9004/?state=abc')).toContain('no code');
		expect(await bad('good-code', s.state + 'x')).toContain('expired');
		const s2 = await (start.POST(post({})) as Response).json();
		expect(await bad('bad-code', s2.state)).toContain('rejected or has expired');
		const s3 = await (start.POST(post({})) as Response).json();
		expect(await bad('no-refresh', s3.state)).toContain('long-lived');
		expect((await failure(() => finish.POST(post({}))))?.status).toBe(400);
	});

	it('parsePasted handles bare codes, queries and junk', () => {
		expect(parsePasted('abc')).toEqual({ code: 'abc' });
		expect(parsePasted('?code=abc&state=s')).toEqual({ code: 'abc', state: 's' });
		expect(parsePasted('code=abc&state=s')).toEqual({ code: 'abc', state: 's' });
		expect(() => parsePasted('  ')).toThrow();
		expect(() => parsePasted('http://[bad?code=1')).toThrow();
	});

	it('re-authorizes an existing source and keeps its calendar choices', async () => {
		const { res } = await connect();
		const { id } = await res.json();
		await one.PATCH({
			locals: adult,
			params: { id },
			request: new Request('http://x', {
				method: 'PATCH',
				body: JSON.stringify({
					calendars: [{ externalId: 'primary@example.com', memberId: 'm1', selected: true }]
				})
			})
		} as never);
		const s = await (start.POST(post({})) as Response).json();
		const r2 = (await finish.POST(
			post({ pasted: 'good-code', state: s.state, sourceId: id })
		)) as Response;
		expect(r2.status).toBe(201);
		const view = listSources(db).find((v) => v.id === id)!;
		expect(view.calendars[0]).toMatchObject({ memberId: 'm1', selected: true });
		const s2 = await (start.POST(post({})) as Response).json();
		expect(
			(
				await failure(() =>
					finish.POST(post({ pasted: 'good-code', state: s2.state, sourceId: 'zzz' }))
				)
			)?.body.message
		).toContain('Unknown');
	});
});
