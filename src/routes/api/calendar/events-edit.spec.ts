import { randomBytes, randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { scopedId } from '#lib/server/domain/calendar/diff.js';
import { HOUSEHOLD_TZ_KEY } from '#lib/domain/time-zone.js';
import { openDb, type Db } from '#lib/server/db/index.js';
import { calendarSources, events, settings } from '#lib/server/db/schema.js';

process.env.HUB_SECRET_KEY = randomBytes(32).toString('base64');

let db: Db;
vi.mock('#lib/server/db/index.js', async (orig) => ({
	...(await orig<typeof import('#lib/server/db/index.js')>()),
	getDb: () => db
}));
const update = vi.fn();
const remove = vi.fn();
const fetchObjects = vi.fn();
vi.mock('tsdav', async (orig) => ({
	...(await orig<typeof import('tsdav')>()),
	updateCalendarObject: (...a: unknown[]) => update(...a),
	deleteCalendarObject: (...a: unknown[]) => remove(...a),
	fetchCalendarObjects: (...a: unknown[]) => fetchObjects(...a)
}));

const route = await import('./events/[id]/+server.js');
const { CHANGED_MESSAGE, REAUTH_MESSAGE, RECURRING_MESSAGE, sealCredentials } =
	await import('#lib/server/calendar/icloud.js');
const { getKeyring } = await import('#lib/server/keys.js');

const CAL = 'https://caldav.example.test/1/calendars/home/';
const OBJECT_URL = `${CAL}phone-1.ics`;
const START = Date.UTC(2026, 9, 20, 21, 0);
const adult = { adult: { id: 'a', name: 'A' } };
const ics = (extra = '') =>
	[
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//Apple Inc.//iOS//EN',
		'BEGIN:VEVENT',
		'UID:phone-1',
		'DTSTAMP:20260101T000000Z',
		'DTSTART:20261020T210000Z',
		'DTEND:20261020T220000Z',
		'SUMMARY:Old title',
		'LOCATION:Old hall',
		'ATTENDEE;CN=Pat Example:mailto:pat@example.test',
		extra,
		'END:VEVENT',
		'END:VCALENDAR',
		''
	]
		.filter((l, i, a) => l !== '' || i === a.length - 1)
		.join('\r\n');
const edit = {
	title: 'New title',
	allDay: false,
	start: '2026-10-20T18:00',
	end: '2026-10-20T19:30',
	location: 'Old hall'
};
const put = (id: string, body: unknown, locals: unknown = adult) =>
	route.PUT({
		locals,
		params: { id },
		request: new Request('http://x', { method: 'PUT', body: JSON.stringify(body) })
	} as never);
const del = (id: string, locals: unknown = adult) =>
	route.DELETE({ locals, params: { id } } as never);
const outcome = async (f: () => unknown) => {
	try {
		await f();
	} catch (e) {
		return e as { status: number; body: { message: string } };
	}
};

describe('PUT/DELETE /api/calendar/events/[id]', () => {
	let sourceId: string;
	const eventId = 'ev-1';
	beforeEach(() => {
		db = openDb(':memory:');
		// Wall times resolve in the household zone, which defaults to the process TZ: pin it.
		db.insert(settings)
			.values({ key: HOUSEHOLD_TZ_KEY, value: JSON.stringify('America/New_York') })
			.run();
		update.mockReset().mockResolvedValue({ ok: true, status: 204 });
		remove.mockReset().mockResolvedValue({ ok: true, status: 204 });
		fetchObjects.mockReset().mockResolvedValue([{ url: OBJECT_URL, etag: '"e1"', data: ics() }]);
		sourceId = randomUUID();
		db.insert(calendarSources)
			.values({
				id: sourceId,
				provider: 'icloud',
				label: 'Apple',
				credentials: sealCredentials(getKeyring(), sourceId, {
					appleId: 'jane@example.com',
					appPassword: 'abcd-efgh-ijkl-mnop'
				}),
				calendars: JSON.stringify([{ externalId: CAL, name: 'Home' }])
			})
			.run();
		db.insert(events)
			.values({
				id: eventId,
				sourceId,
				externalId: scopedId(CAL, `phone-1::${new Date(START).toISOString()}`),
				title: 'Old title',
				startsAt: START,
				endsAt: START + 3_600_000,
				location: 'Old hall'
			})
			.run();
	});

	it('requires an adult', async () => {
		expect((await outcome(() => put(eventId, edit, {})))?.status).toBe(401);
		expect((await outcome(() => del(eventId, {})))?.status).toBe(401);
		expect(update).not.toHaveBeenCalled();
		expect(remove).not.toHaveBeenCalled();
	});

	it('PUTs the modified object with the ETag, keeping what the hub does not edit', async () => {
		expect((await put(eventId, edit)).status).toBe(200);
		const arg = update.mock.calls[0]![0] as {
			calendarObject: { url: string; etag: string; data: string };
		};
		expect(arg.calendarObject.url).toBe(OBJECT_URL);
		expect(arg.calendarObject.etag).toBe('"e1"');
		expect(arg.calendarObject.data).toContain('UID:phone-1');
		expect(arg.calendarObject.data).toContain('SUMMARY:New title');
		expect(arg.calendarObject.data).toContain('DTSTART:20261020T220000Z');
		expect(arg.calendarObject.data).toContain('ATTENDEE;CN=Pat Example');
		expect(fetchObjects).toHaveBeenCalledTimes(2); // locate, then the refresh
	});

	it('validates like create without calling Apple', async () => {
		for (const patch of [{ title: '' }, { end: '2026-10-20T16:00' }]) {
			expect((await outcome(() => put(eventId, { ...edit, ...patch })))?.status).toBe(400);
		}
		expect(fetchObjects).not.toHaveBeenCalled();
	});

	it('404s an unknown event and refuses non-iCloud sources', async () => {
		expect((await outcome(() => put('nope', edit)))?.status).toBe(404);
		db.update(calendarSources).set({ provider: 'google' }).run();
		expect((await outcome(() => put(eventId, edit)))?.status).toBe(400);
		expect((await outcome(() => del(eventId)))?.status).toBe(400);
	});

	it('answers 409 on a 412 and refetches', async () => {
		update.mockResolvedValue({ ok: false, status: 412 });
		const err = await outcome(() => put(eventId, edit));
		expect(err?.status).toBe(409);
		expect(err?.body.message).toBe(CHANGED_MESSAGE);
		expect(fetchObjects).toHaveBeenCalledTimes(2);
	});

	it('answers 409 when Apple already differs from what the hub showed', async () => {
		fetchObjects.mockResolvedValue([
			{ url: OBJECT_URL, etag: '"e2"', data: ics().replace('Old title', 'Phone title') }
		]);
		const err = await outcome(() => put(eventId, edit));
		expect(err?.status).toBe(409);
		expect(err?.body.message).toBe(CHANGED_MESSAGE);
		expect(update).not.toHaveBeenCalled();
	});

	it('answers 409 when the event is gone from Apple', async () => {
		fetchObjects.mockResolvedValue([]);
		expect((await outcome(() => del(eventId)))?.body.message).toBe(CHANGED_MESSAGE);
		expect(remove).not.toHaveBeenCalled();
	});

	it('refuses recurring events', async () => {
		fetchObjects.mockResolvedValue([
			{ url: OBJECT_URL, etag: '"e1"', data: ics('RRULE:FREQ=WEEKLY') }
		]);
		for (const run of [() => put(eventId, edit), () => del(eventId)]) {
			const err = await outcome(run);
			expect(err?.status).toBe(409);
			expect(err?.body.message).toBe(RECURRING_MESSAGE);
		}
		expect(update).not.toHaveBeenCalled();
		expect(remove).not.toHaveBeenCalled();
	});

	it('maps an Apple 401 to the re-auth message', async () => {
		update.mockResolvedValue({ ok: false, status: 401 });
		const err = await outcome(() => put(eventId, edit));
		expect(err?.status).toBe(401);
		expect(err?.body.message).toBe(REAUTH_MESSAGE);
	});

	it('maps other failures to a safe message', async () => {
		update.mockRejectedValue(new Error('boom jane@example.com abcd-efgh-ijkl-mnop'));
		const err = await outcome(() => put(eventId, edit));
		expect(err?.status).toBe(502);
		expect(JSON.stringify(err?.body)).not.toMatch(/jane@|abcd/);
	});

	it('DELETEs with the ETag and refreshes', async () => {
		expect((await del(eventId)).status).toBe(200);
		const arg = remove.mock.calls[0]![0] as { calendarObject: { url: string; etag: string } };
		expect(arg.calendarObject).toMatchObject({ url: OBJECT_URL, etag: '"e1"' });
		expect(fetchObjects).toHaveBeenCalledTimes(2);
	});

	it('treats a 404 on delete as done, and a 412 as a conflict', async () => {
		remove.mockResolvedValue({ ok: false, status: 404 });
		expect((await del(eventId)).status).toBe(200);
		remove.mockResolvedValue({ ok: false, status: 412 });
		expect((await outcome(() => del(eventId)))?.status).toBe(409);
	});
});
