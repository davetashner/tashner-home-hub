import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../db/index.js';
import { calendarSources, settings } from '../db/schema.js';
import { getKeyring } from '../keys.js';
import {
	IcsError,
	calendarIdFor,
	createIcsProvider,
	fetchIcs,
	maskedHost,
	normalizeUrl,
	openUrl,
	probeIcs,
	sealUrl
} from './ics.js';
import { listEvents } from './read.js';
import { runSync } from './sync.js';

const feed = readFileSync(
	new URL('../domain/calendar/fixtures/school.ics', import.meta.url),
	'utf8'
);
process.env.HUB_SECRET_KEY = randomBytes(32).toString('base64');
const keyring = getKeyring();

let server: Server;
let base: string;
let hits: { inm?: string | undefined }[] = [];

beforeAll(async () => {
	server = createServer((req, res) => {
		const path = req.url ?? '';
		hits.push({ inm: req.headers['if-none-match'] });
		if (path === '/feed.ics') {
			if (req.headers['if-none-match'] === '"v1"') {
				res.writeHead(304).end();
				return;
			}
			res.writeHead(200, { 'content-type': 'text/calendar', etag: '"v1"' }).end(feed);
		} else if (path === '/redirect') {
			res.writeHead(302, { location: '/feed.ics' }).end();
		} else if (path === '/loop') {
			res.writeHead(302, { location: '/loop' }).end();
		} else if (path === '/big') {
			res.writeHead(200, { 'content-length': String(20_000_000) }).end('x');
		} else if (path === '/stream-big') {
			res.writeHead(200);
			res.end('x'.repeat(2000));
		} else if (path === '/hang') {
			// never answers
		} else if (path === '/always304') {
			res.writeHead(304).end();
		} else if (path === '/html') {
			res.writeHead(200).end('<html>nope</html>');
		} else {
			res.writeHead(404).end();
		}
	});
	await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
	server.closeAllConnections();
	server.close();
});

describe('url helpers', () => {
	it('maps webcal to https and rejects other schemes', () => {
		expect(normalizeUrl('webcal://example.com/a.ics').href).toBe('https://example.com/a.ics');
		expect(normalizeUrl('WEBCALS://example.com/a.ics').protocol).toBe('https:');
		expect(() => normalizeUrl('ftp://example.com/a.ics')).toThrow(IcsError);
		expect(
			normalizeUrl('webcal://outlook.office365.com/owa/calendar/user@example.com/abc/calendar.ics')
				.href
		).toBe('https://outlook.office365.com/owa/calendar/user@example.com/abc/calendar.ics');
		// The HTML link Outlook shows next to the ICS one is switched to the feed.
		expect(
			normalizeUrl('https://outlook.office365.com/owa/calendar/abc/cal/calendar.html').pathname
		).toBe('/owa/calendar/abc/cal/calendar.ics');
		expect(normalizeUrl('https://example.com/calendar.html').pathname).toBe('/calendar.html');
		expect(() => normalizeUrl('not a url')).toThrow(/look like/);
	});
	it('masks to the host and hashes stably', () => {
		expect(maskedHost('https://example.com/private/token123.ics')).toBe('example.com');
		expect(maskedHost('garbage')).toBe('');
		expect(calendarIdFor('https://a')).toBe(calendarIdFor('https://a'));
		expect(calendarIdFor('https://a')).not.toBe(calendarIdFor('https://b'));
	});
});

describe('fetchIcs', () => {
	beforeEach(() => {
		hits = [];
	});

	it('fetches, then honors If-None-Match with a 304', async () => {
		const first = await fetchIcs(`${base}/feed.ics`);
		expect(first.body).toContain('BEGIN:VCALENDAR');
		expect(first.etag).toBe('"v1"');
		const second = await fetchIcs(`${base}/feed.ics`, { etag: first.etag });
		expect(second.body).toBeNull();
		expect(hits[1]!.inm).toBe('"v1"');
	});

	it('follows a redirect but gives up on loops', async () => {
		expect((await fetchIcs(`${base}/redirect`)).body).toContain('VCALENDAR');
		await expect(fetchIcs(`${base}/loop`, { maxRedirects: 2 })).rejects.toThrow(/redirects/);
	});

	it('enforces the size cap by header and by streamed bytes', async () => {
		await expect(fetchIcs(`${base}/big`)).rejects.toThrow(/too large/);
		await expect(fetchIcs(`${base}/stream-big`, { maxBytes: 1000 })).rejects.toThrow(/too large/);
	});

	it('times out, and reports HTTP errors and unreachable hosts', async () => {
		await expect(fetchIcs(`${base}/hang`, { timeoutMs: 100 })).rejects.toThrow(/too long/);
		await expect(fetchIcs(`${base}/missing`)).rejects.toThrow(/404/);
		await expect(fetchIcs('http://127.0.0.1:1/x')).rejects.toThrow(/Could not reach/);
	});

	it('probeIcs validates content', async () => {
		const p = await probeIcs(`${base}/feed.ics`);
		expect(p.name).toBe('Example Elementary');
		expect(p.events.length).toBeGreaterThan(5);
		await expect(probeIcs(`${base}/html`)).rejects.toThrow(/not a valid|not an iCalendar/);
	});
});

describe('provider and sync', () => {
	let db: Db;
	beforeEach(() => {
		db = openDb(':memory:');
	});

	function addSource(url: string, id = 'src1') {
		db.insert(calendarSources)
			.values({
				id,
				provider: 'ics',
				label: 'School',
				credentials: sealUrl(keyring, id, url),
				calendars: JSON.stringify([
					{ externalId: calendarIdFor(url), name: 'School', memberId: null }
				])
			})
			.run();
		return db.select().from(calendarSources).get()!;
	}

	it('stores the URL encrypted and round-trips it', () => {
		const url = `${base}/feed.ics?token=secret-token`;
		const src = addSource(url);
		expect(src.credentials).not.toContain('secret-token');
		expect(openUrl(keyring, src)).toBe(url);
		expect(() => openUrl(keyring, { id: 'other', credentials: src.credentials })).toThrow();
		expect(() => openUrl(keyring, { id: 'x', credentials: null })).toThrow(IcsError);
	});

	it('lists one calendar and caches ETag so the second sync is a 304', async () => {
		const src = addSource(`${base}/feed.ics`);
		const provider = createIcsProvider(src, { db, keyring });
		expect(await provider.listCalendars()).toEqual([
			{ externalId: calendarIdFor(`${base}/feed.ics`), name: 'School' }
		]);
		hits = [];
		const first = await provider.fetchEvents('x', { start: 0, end: 1 });
		const second = await provider.fetchEvents('x', { start: 0, end: 1 });
		expect(second).toEqual(first);
		expect(hits.map((h) => h.inm)).toEqual([undefined, '"v1"']);
		expect((await provider.listCalendars())[0]!.name).toBe('Example Elementary');
		expect(
			db
				.select()
				.from(settings)
				.all()
				.some((s) => s.key === 'calendar.ics.cache.src1')
		).toBe(true);
	});

	it('a 304 with nothing cached is an error', async () => {
		await expect(probeIcs(`${base}/always304`)).rejects.toThrow(/no content/);
	});

	it('runSync expands the feed into events that the events API can read', async () => {
		addSource(`${base}/feed.ics`);
		// Inject the provider: the registry's default one opens the shared on-disk ./data/hub.db.
		const result = await runSync(db, {
			now: () => Date.parse('2026-02-01'),
			provider: (source) => createIcsProvider(source, { db, keyring })
		});
		expect(result.src1!.lastError).toBeNull();
		const jan = listEvents(db, Date.parse('2026-01-01'), Date.parse('2026-02-01'));
		const band = jan.filter((e) => e.title.startsWith('Band'));
		// Mondays Jan 5, (12 excluded), 19 overridden, (26 cancelled)
		expect(band.map((e) => e.title)).toEqual(['Band practice', 'Band practice (gym)']);
		const later = listEvents(db, Date.parse('2026-02-01'), Date.parse('2026-04-01'));
		expect(later.filter((e) => e.title === 'Board meeting')).toHaveLength(2); // start + RDATE
		expect(later.find((e) => e.title === 'Spring break')).toMatchObject({ allDay: true });
	});
});
