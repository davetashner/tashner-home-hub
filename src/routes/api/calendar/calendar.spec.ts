import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '#lib/server/db/index.js';
import { calendarSources } from '#lib/server/db/schema.js';

let db: Db;
vi.mock('#lib/server/db/index.js', async (orig) => ({
	...(await orig<typeof import('#lib/server/db/index.js')>()),
	getDb: () => db
}));

const events = await import('./events/+server.js');
const status = await import('./status/+server.js');
const sync = await import('./sync/+server.js');
const scheduler = await import('#lib/server/calendar/scheduler.js');

beforeEach(() => {
	db = openDb(':memory:');
});

const get = (qs: string) => ({ url: new URL(`http://x/api/calendar/events${qs}`) }) as never;
async function statusOf(f: () => unknown) {
	try {
		await f();
	} catch (e) {
		return (e as { status: number }).status;
	}
}

describe('calendar API', () => {
	it('GET events validates the range and returns a list', async () => {
		expect(await statusOf(() => events.GET(get('')))).toBe(400);
		expect(await statusOf(() => events.GET(get('?start=2026-01-02&end=2026-01-01')))).toBe(400);
		const res = await events.GET(get('?start=2026-01-01&end=1798761600000'));
		expect(await res.json()).toEqual([]);
	});

	it('GET status reports sources', async () => {
		db.insert(calendarSources).values({ id: 's', provider: 'ics', label: 'L' }).run();
		const body = await (await status.GET({} as never)).json();
		expect(body.stale).toBe(true);
		expect(body.sources[0]).toMatchObject({ sourceId: 's', lastSyncAt: null });
	});

	it('POST sync runs and reports per-source results', async () => {
		db.insert(calendarSources).values({ id: 's', provider: 'ics', label: 'L' }).run();
		expect(await statusOf(() => sync.POST({ locals: { adult: null } } as never))).toBe(401);
		const adult = { locals: { adult: { id: 'a', name: 'A' } } } as never;
		const body = await (await sync.POST(adult)).json();
		expect(body.s.lastError).toMatch(/not implemented/);
	});

	it('scheduler starts a cron and can be stopped', () => {
		const job = scheduler.startCalendarScheduler({});
		expect(job).toBeDefined();
		job!.stop();
	});
});
