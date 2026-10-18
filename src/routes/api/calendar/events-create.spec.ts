import { randomBytes, randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '#lib/server/db/index.js';
import { calendarSources, events } from '#lib/server/db/schema.js';

process.env.HUB_SECRET_KEY = randomBytes(32).toString('base64');

let db: Db;
vi.mock('#lib/server/db/index.js', async (orig) => ({
	...(await orig<typeof import('#lib/server/db/index.js')>()),
	getDb: () => db
}));
const create = vi.fn();
const fetchObjects = vi.fn();
vi.mock('tsdav', async (orig) => ({
	...(await orig<typeof import('tsdav')>()),
	createCalendarObject: (...a: unknown[]) => create(...a),
	fetchCalendarObjects: (...a: unknown[]) => fetchObjects(...a)
}));

const route = await import('./events/+server.js');
const { REAUTH_MESSAGE, sealCredentials } = await import('#lib/server/calendar/icloud.js');
const { getKeyring } = await import('#lib/server/keys.js');

const CAL = 'https://caldav.example.test/1/calendars/home/';
const adult = { adult: { id: 'a', name: 'A' } };
const valid = {
	calendarId: CAL,
	title: 'Piano recital',
	allDay: false,
	start: '2026-10-20T17:00',
	end: '2026-10-20T18:00',
	location: 'Hall',
	notes: 'Bring music'
};
const post = (body: unknown, locals: unknown = adult) =>
	route.POST({
		locals,
		request: new Request('http://x', { method: 'POST', body: JSON.stringify(body) })
	} as never);
const outcome = async (f: () => unknown) => {
	try {
		await f();
	} catch (e) {
		return e as { status: number; body: { message: string } };
	}
};

describe('POST /api/calendar/events', () => {
	let sourceId: string;
	beforeEach(() => {
		db = openDb(':memory:');
		create.mockReset();
		fetchObjects.mockReset();
		create.mockResolvedValue({ ok: true, status: 201 });
		fetchObjects.mockResolvedValue([]);
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
				calendars: JSON.stringify([
					{ externalId: CAL, name: 'Home' },
					{
						externalId: 'https://caldav.example.test/1/calendars/off/',
						name: 'Off',
						selected: false
					}
				])
			})
			.run();
	});

	it('requires an adult', async () => {
		const err = await outcome(() => post(valid, {}));
		expect(err?.status).toBe(401);
		expect(create).not.toHaveBeenCalled();
	});

	it('writes the event to Apple, then refreshes the calendar', async () => {
		const res = await post(valid);
		expect(res.status).toBe(201);
		const { uid } = await res.json();
		expect(uid).toMatch(/@hub$/);
		const arg = create.mock.calls[0]![0] as {
			filename: string;
			iCalString: string;
			calendar: { url: string };
		};
		expect(arg.calendar.url).toBe(CAL);
		expect(arg.filename).toBe(`${uid}.ics`);
		expect(arg.iCalString).toContain('SUMMARY:Piano recital');
		expect(arg.iCalString).toContain('LOCATION:Hall');
		expect(fetchObjects).toHaveBeenCalledOnce();
	});

	it('shows the new event after the refresh returns it', async () => {
		fetchObjects.mockImplementation(async () => {
			const ics = (create.mock.calls[0]![0] as { iCalString: string }).iCalString;
			return [{ url: `${CAL}x.ics`, etag: '1', data: ics }];
		});
		await post(valid);
		const rows = db.select().from(events).all();
		expect(rows.map((r) => r.title)).toEqual(['Piano recital']);
	});

	it('rejects invalid input without calling Apple', async () => {
		for (const patch of [
			{ title: '' },
			{ title: 'x'.repeat(201) },
			{ end: '2026-10-20T16:00' },
			{ calendarId: '' }
		]) {
			expect((await outcome(() => post({ ...valid, ...patch })))?.status).toBe(400);
		}
		expect(create).not.toHaveBeenCalled();
	});

	it('rejects a calendar that is unknown, hidden or not iCloud', async () => {
		for (const calendarId of [
			'https://nope.example.test/',
			'https://caldav.example.test/1/calendars/off/'
		]) {
			expect((await outcome(() => post({ ...valid, calendarId })))?.status).toBe(404);
		}
		db.insert(calendarSources)
			.values({
				id: 'ics1',
				provider: 'ics',
				label: 'Feed',
				calendars: JSON.stringify([{ externalId: 'feed' }])
			})
			.run();
		expect((await outcome(() => post({ ...valid, calendarId: 'feed' })))?.status).toBe(404);
		expect(create).not.toHaveBeenCalled();
	});

	it('maps an Apple 401 to the re-auth message', async () => {
		create.mockResolvedValue({ ok: false, status: 401 });
		const err = await outcome(() => post(valid));
		expect(err?.status).toBe(401);
		expect(err?.body.message).toBe(REAUTH_MESSAGE);
	});

	it('maps other failures to a safe message', async () => {
		create.mockRejectedValue(new Error('boom jane@example.com abcd-efgh-ijkl-mnop'));
		const err = await outcome(() => post(valid));
		expect(err?.status).toBe(502);
		expect(JSON.stringify(err?.body)).not.toContain('jane@');
		expect(JSON.stringify(err?.body)).not.toContain('abcd');
	});
});
