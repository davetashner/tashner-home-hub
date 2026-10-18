import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../db/index.js';
import { addIcloudSource } from './icloud-add.js';
import { calendarSources } from '../db/schema.js';
import { getKeyring } from '../keys.js';
import {
	IcloudError,
	REAUTH_MESSAGE,
	createIcloudEvent,
	createIcloudProvider,
	discoverCalendars,
	fetchIcloudEvents,
	maskAppleId,
	openCredentials,
	probeIcloud,
	sealCredentials
} from './icloud.js';
import { listEvents } from './read.js';
import { viewOf } from './sources.js';
import { readStatuses, runSync } from './sync.js';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'hub-icloud-'));
process.env.HUB_SECRET_KEY = randomBytes(32).toString('base64');
const keyring = getKeyring();

const USER = 'jane@example.com';
const PASS = 'abcd-efgh-ijkl-mnop';
const NS = 'xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"';
const ms = (body: string) => `<?xml version="1.0"?><d:multistatus ${NS}>${body}</d:multistatus>`;
const resp = (href: string, props: string) =>
	`<d:response><d:href>${href}</d:href><d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
const cal = (href: string, name: string, comp: string) =>
	resp(
		href,
		`<d:displayname>${name}</d:displayname><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><c:supported-calendar-component-set><c:comp name="${comp}"/></c:supported-calendar-component-set>`
	);

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Example//EN
BEGIN:VEVENT
UID:soccer-1
DTSTAMP:20260101T000000Z
DTSTART;TZID=America/New_York:20261020T170000
DTEND;TZID=America/New_York:20261020T183000
SUMMARY:Soccer practice
RRULE:FREQ=WEEKLY
END:VEVENT
END:VCALENDAR`;
const ICS_ALLDAY = ICS.replace(/DTSTART.*\n/, 'DTSTART;VALUE=DATE:20261021\n')
	.replace(/DTEND.*\n/, 'DTEND;VALUE=DATE:20261022\n')
	.replace('soccer-1', 'holiday-1')
	.replace('RRULE:FREQ=WEEKLY\n', '')
	.replace('Soccer practice', 'Holiday');

let server: Server;
let base: string;
let seen: string[] = [];
let reject = false;

beforeAll(async () => {
	server = createServer((req, res) => {
		let body = '';
		req.on('data', (c) => (body += c));
		req.on('end', () => {
			seen.push(`${req.method} ${req.url} ${body}`);
			const auth = `Basic ${Buffer.from(`${USER}:${PASS}`).toString('base64')}`;
			if (reject || req.headers.authorization !== auth) {
				res.writeHead(401, { 'www-authenticate': 'Basic realm="x"' }).end();
				return;
			}
			const xml = { 'content-type': 'application/xml; charset=utf-8' };
			const url = req.url ?? '';
			let out: string;
			if (req.method === 'REPORT') {
				out = ms(
					resp(
						'/123/calendars/home/e1.ics',
						`<d:getetag>"1"</d:getetag><c:calendar-data>${ICS.replace(/&/g, '&amp;')}</c:calendar-data>`
					) +
						resp(
							'/123/calendars/home/e2.ics',
							`<d:getetag>"2"</d:getetag><c:calendar-data>${ICS_ALLDAY}</c:calendar-data>`
						) +
						resp('/123/calendars/home/bad.ics', `<c:calendar-data>garbage</c:calendar-data>`)
				);
			} else if (url === '/') {
				out = ms(
					resp(
						'/',
						'<d:current-user-principal><d:href>/123/principal/</d:href></d:current-user-principal>'
					)
				);
			} else if (url.startsWith('/123/principal')) {
				out = ms(
					resp(
						'/123/principal/',
						`<c:calendar-home-set><d:href>${base}/123/calendars/</d:href></c:calendar-home-set>`
					)
				);
			} else {
				out = ms(
					cal('/123/calendars/home/', 'Family', 'VEVENT') +
						cal('/123/calendars/work/', 'Work', 'VEVENT') +
						cal('/123/calendars/reminders/', 'Reminders', 'VTODO')
				);
			}
			res.writeHead(207, xml).end(out);
		});
	});
	await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => void server.close());
beforeEach(() => {
	seen = [];
	reject = false;
});

const creds = { appleId: USER, appPassword: PASS };
const opts = () => ({ serverUrl: base });
const HOME = () => `${base}/123/calendars/home/`;

describe('maskAppleId', () => {
	it('masks the local part', () => {
		expect(maskAppleId(USER)).toBe('j•••@example.com');
		expect(maskAppleId('x')).toBe('x•••');
		expect(maskAppleId('')).toBe('');
	});
});

describe('discovery', () => {
	it('lists VEVENT calendars and skips reminders', async () => {
		const cals = await discoverCalendars(creds, opts());
		expect(cals.map((c) => c.name)).toEqual(['Family', 'Work']);
		expect(cals[0]!.externalId).toBe(HOME());
	});

	it('turns a 401 into the friendly re-auth error', async () => {
		const err = await discoverCalendars({ ...creds, appPassword: 'wrong' }, opts()).catch((e) => e);
		expect(err).toBeInstanceOf(IcloudError);
		expect(err.message).toBe(REAUTH_MESSAGE);
		expect(err.needsReauth).toBe(true);
		expect(err.message).not.toContain('wrong');
		expect(err.message).not.toContain(USER);
	});

	it('reports unreachable servers without leaking details', async () => {
		const err = await discoverCalendars(creds, { serverUrl: 'http://127.0.0.1:1' }).catch((e) => e);
		expect(err.message).toBe('Could not reach Apple calendar servers');
		expect(err.needsReauth).toBe(false);
	});

	it('probeIcloud rejects accounts with no calendars', async () => {
		await expect(
			probeIcloud(creds, { serverUrl: `${base}/empty-not-used`, timeoutMs: 1 })
		).rejects.toBeInstanceOf(IcloudError);
	});
});

describe('createIcloudEvent', () => {
	const event = {
		title: 'Piano, recital',
		time: {
			allDay: false as const,
			startMs: Date.UTC(2026, 9, 20, 21),
			endMs: Date.UTC(2026, 9, 20, 22)
		}
	};

	it('PUTs <uid>.ics into the calendar with the VEVENT body', async () => {
		const { uid } = await createIcloudEvent(creds, HOME(), event, opts());
		expect(uid).toMatch(/@hub$/);
		const put = seen.find((s) => s.startsWith('PUT'))!;
		expect(put).toContain(`PUT /123/calendars/home/${uid}.ics`);
		expect(put).toContain('BEGIN:VEVENT');
		expect(put).toContain('SUMMARY:Piano\\, recital');
		expect(put).toContain('DTSTART:20261020T210000Z');
	});

	it('maps a 401 to the re-auth error without leaking credentials', async () => {
		reject = true;
		const err = await createIcloudEvent(creds, HOME(), event, opts()).catch((e) => e);
		expect(err.needsReauth).toBe(true);
		expect(err.message).toBe(REAUTH_MESSAGE);
		expect(err.message).not.toContain(PASS);
	});
});

describe('fetchIcloudEvents', () => {
	const window = { start: Date.UTC(2026, 9, 1), end: Date.UTC(2027, 3, 1) };

	it('sends a time-range query and parses masters and all-day events', async () => {
		const events = await fetchIcloudEvents(creds, HOME(), window, 'America/New_York', opts());
		expect(events.map((e) => e.uid).sort()).toEqual(['holiday-1', 'soccer-1']);
		const soccer = events.find((e) => e.uid === 'soccer-1')!;
		expect(soccer.rrule).toBe('FREQ=WEEKLY');
		expect(soccer.start).toEqual({ dateTime: '2026-10-20T17:00:00', timeZone: 'America/New_York' });
		const report = seen.find((s) => s.startsWith('REPORT'))!;
		expect(report).toContain('time-range');
		expect(report).toContain('20261001T000000Z');
	});

	it('maps a 401 to the re-auth error', async () => {
		reject = true;
		const err = await fetchIcloudEvents(creds, HOME(), window, 'UTC', opts()).catch((e) => e);
		expect(err.needsReauth).toBe(true);
	});
});

describe('end to end', () => {
	it('syncs a stored iCloud source into events and flags re-auth later', async () => {
		const db = openDb(':memory:');
		const id = 'src-icloud';
		const row = {
			id,
			provider: 'icloud' as const,
			label: 'Apple',
			credentials: sealCredentials(keyring, id, creds),
			calendars: JSON.stringify([
				{ externalId: HOME(), name: 'Family', memberId: null },
				{ externalId: `${base}/123/calendars/work/`, name: 'Work', memberId: null, selected: false }
			])
		};
		db.insert(calendarSources).values(row).run();
		expect(openCredentials(keyring, row)).toEqual(creds);
		expect(row.credentials).not.toContain(PASS);

		const providerFor = (s: typeof row) =>
			createIcloudProvider(s as never, { keyring, options: opts() });
		const now = Date.UTC(2026, 9, 15);
		await runSync(db, { now: () => now, provider: providerFor as never });
		const evs = listEvents(db, now, now + 30 * 86_400_000);
		expect(evs.map((e) => e.title)).toContain('Soccer practice');
		expect(evs.map((e) => e.title)).toContain('Holiday');
		// only the selected calendar was queried
		expect(seen.filter((s) => s.startsWith('REPORT')).every((s) => s.includes('/home/'))).toBe(
			true
		);

		reject = true;
		const statuses = await runSync(db, { now: () => now + 1, provider: providerFor as never });
		const status = statuses[id]!;
		expect(status.lastError).toContain(REAUTH_MESSAGE);
		expect(status.needsReauth).toBe(true);
		const statusJson = JSON.stringify(readStatuses(db));
		for (const bad of ['caldav', '/123/', '127.0.0.1', 'http', 'calendars/'])
			expect(statusJson).not.toContain(bad);
		const view = viewOf(db.select().from(calendarSources).get()!, readStatuses(db));
		expect(view.needsReauth).toBe(true);
		expect(view.account).toBe('j•••@example.com');
		const dump = JSON.stringify(view) + JSON.stringify(status);
		expect(dump).not.toContain(PASS);
		expect(dump).not.toContain(USER);
		expect(view.calendars[1]!.selected).toBe(false);
	});
});

describe('addIcloudSource', () => {
	const post = (body: Record<string, unknown>) => addIcloudSource(body, opts());

	it('stores the source with all calendars unselected and masks the account', async () => {
		const res = await post({ label: 'Apple', appleId: USER, appPassword: PASS });
		expect(res.status).toBe(201);
		const text = await res.text();
		const view = JSON.parse(text);
		expect(view.account).toBe('j•••@example.com');
		expect(view.calendars.map((c: { name: string }) => c.name)).toEqual(['Family', 'Work']);
		expect(view.calendars.every((c: { selected: boolean }) => !c.selected)).toBe(true);
		expect(text).not.toContain(PASS);
		expect(text).not.toContain(USER);
	});

	it('answers 401 with the friendly message for a bad password', async () => {
		const err = await post({ label: 'Apple', appleId: USER, appPassword: 'nope' }).catch((e) => e);
		expect(err.status).toBe(401);
		expect(err.body.message).toBe(REAUTH_MESSAGE);
	});

	it('validates input', async () => {
		const err = await post({ label: 'Apple', appleId: USER }).catch((e) => e);
		expect(err.status).toBe(400);
	});
});
