import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb, type Db } from '../db/index.js';
import { calendarSources, events } from '../db/schema.js';
import { seedMembers } from '../dev/seed.js';
import type { RemoteEvent } from '../domain/calendar/types.js';
import { FakeProvider, createProvider, providerRegistry, type CalendarSource } from './provider.js';
import { listEvents, syncStatus } from './read.js';
import { runSync, STALE_AFTER_MS, syncAll, syncSource, syncWindow } from './sync.js';
import { startCalendarScheduler } from './scheduler.js';

const NOW = Date.parse('2026-03-01T12:00:00Z');
const DAY = 86_400_000;
let db: Db;
let memberId: string;

beforeEach(() => {
	db = openDb(':memory:');
	memberId = seedMembers(db)[0]!.id;
});

function addSource(id: string, calendars: { externalId: string; memberId?: string | null }[]) {
	db.insert(calendarSources)
		.values({ id, provider: 'ics', label: id, calendars: JSON.stringify(calendars) })
		.run();
	return db.select().from(calendarSources).where(eq(calendarSources.id, id)).get()!;
}
const ev = (uid: string, date: string, extra: Partial<RemoteEvent> = {}): RemoteEvent => ({
	uid,
	title: uid,
	start: { date },
	...extra
});
const rows = () => db.select().from(events).all();

describe('syncSource', () => {
	it('upserts expanded events with member mapping, idempotently', async () => {
		const src = addSource('s1', [{ externalId: 'cal', memberId }]);
		const p = new FakeProvider({
			cal: [ev('a', '2026-03-05'), ev('r', '2026-03-02', { rrule: 'FREQ=WEEKLY;COUNT=3' })]
		});
		const deps = { now: () => NOW, provider: () => p };
		await syncSource(db, src, deps);
		const first = rows();
		expect(first).toHaveLength(4);
		expect(JSON.parse(first[0]!.memberIds)).toEqual([memberId]);
		await syncSource(db, src, deps);
		expect(
			rows()
				.map((r) => r.id)
				.sort()
		).toEqual(first.map((r) => r.id).sort());
	});

	it('updates changed events and deletes ones removed remotely', async () => {
		const src = addSource('s1', [{ externalId: 'cal' }]);
		const p = new FakeProvider({ cal: [ev('a', '2026-03-05'), ev('b', '2026-03-06')] });
		const deps = { now: () => NOW, provider: () => p };
		await syncSource(db, src, deps);
		p.calendars.cal = [ev('a', '2026-03-05', { title: 'renamed' })];
		await syncSource(db, src, deps);
		expect(rows().map((r) => r.title)).toEqual(['renamed']);
	});

	it('removes events when a calendar is deselected', async () => {
		const src = addSource('s1', [{ externalId: 'x' }, { externalId: 'y' }]);
		const p = new FakeProvider({ x: [ev('a', '2026-03-05')], y: [ev('b', '2026-03-06')] });
		await syncSource(db, src, { now: () => NOW, provider: () => p });
		db.update(calendarSources)
			.set({ calendars: '[{"externalId":"x"}]' })
			.where(eq(calendarSources.id, 's1'))
			.run();
		const updated = db.select().from(calendarSources).get()!;
		await syncSource(db, updated, { now: () => NOW, provider: () => p });
		expect(rows().map((r) => r.title)).toEqual(['a']);
	});

	it('keeps data and records the error when a calendar fails', async () => {
		const src = addSource('s1', [{ externalId: 'x' }, { externalId: 'y' }]);
		const p = new FakeProvider({ x: [ev('a', '2026-03-05')], y: [ev('b', '2026-03-06')] });
		await syncSource(db, src, { now: () => NOW, provider: () => p });
		p.failing.add('y');
		p.calendars.x = [];
		const status = await syncSource(db, src, { now: () => NOW + 1000, provider: () => p });
		expect(status.lastError).toContain('fetch failed for y');
		expect(status.lastSuccessAt).toBe(NOW);
		expect(rows().map((r) => r.title)).toEqual(['b']);
		expect(db.select().from(calendarSources).get()!.lastSyncAt).toBe(NOW);
	});

	it('records provider construction failures and tolerates bad calendars JSON', async () => {
		const src = addSource('s1', [{ externalId: 'x' }]);
		const status = await syncSource(db, src, { now: () => NOW });
		expect(status.lastError).toMatch(/not implemented/);
		expect(status.lastSuccessAt).toBeNull();
		const odd = addSource('s2', []);
		db.update(calendarSources).set({ calendars: '{}' }).where(eq(calendarSources.id, 's2')).run();
		const s = await syncSource(
			db,
			{ ...odd, calendars: '{}' },
			{ now: () => NOW, provider: () => new FakeProvider() }
		);
		expect(s.lastError).toBeNull();
	});
});

describe('syncAll and isolation', () => {
	it('one failing source does not affect others', async () => {
		addSource('bad', [{ externalId: 'x' }]);
		addSource('good', [{ externalId: 'x' }]);
		const good = new FakeProvider({ x: [ev('a', '2026-03-05')] });
		const result = await syncAll(db, {
			now: () => NOW,
			provider: (s) => {
				if (s.id === 'bad') throw new Error('boom');
				return good;
			}
		});
		expect(result.bad!.lastError).toBe('boom');
		expect(result.good!.lastError).toBeNull();
		expect(rows()).toHaveLength(1);
	});

	it('computes the rolling window', () => {
		expect(syncWindow(NOW)).toEqual({ start: NOW - 30 * DAY, end: NOW + 180 * DAY });
	});
});

describe('runSync single-flight', () => {
	it('does not start a second run while one is in progress', async () => {
		addSource('s', [{ externalId: 'x' }]);
		let calls = 0;
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		const provider = () => {
			calls++;
			return {
				listCalendars: async () => [],
				fetchEvents: async () => {
					await gate;
					return [];
				}
			};
		};
		const a = runSync(db, { now: () => NOW, provider });
		const b = runSync(db, { now: () => NOW, provider });
		expect(b).toBe(a);
		release();
		await a;
		expect(calls).toBe(1);
		await runSync(db, { now: () => NOW, provider });
		expect(calls).toBe(2);
	});
});

describe('read model', () => {
	it('lists merged events sorted with member colors, and flags staleness', async () => {
		const src = addSource('s', [{ externalId: 'x', memberId }]);
		addSource('t', [{ externalId: 'y' }]);
		const p = new FakeProvider({
			x: [ev('late', '2026-03-09'), ev('early', '2026-03-03')],
			y: [{ uid: 'z', title: 'zero', start: { dateTime: '2026-03-05T10:00', timeZone: 'UTC' } }]
		});
		await syncAll(db, { now: () => NOW, provider: () => p });
		const list = listEvents(db, NOW, NOW + 30 * DAY);
		expect(list.map((e) => e.title)).toEqual(['early', 'zero', 'late']);
		expect(list[0]!.members[0]).toMatchObject({ id: memberId, color: 'member-1' });
		expect(list[1]!.members).toEqual([]);
		expect(src.id).toBe('s');

		expect(syncStatus(db, NOW + 1000).stale).toBe(false);
		const st = syncStatus(db, NOW + STALE_AFTER_MS + 1);
		expect(st.stale).toBe(true);
		expect(st.sources[0]!.lastSyncAt).toBe(NOW);
		addSource('never', []);
		expect(syncStatus(db, NOW).sources.find((s) => s.sourceId === 'never')).toMatchObject({
			lastSyncAt: null,
			stale: true
		});
	});
});

describe('registry and scheduler', () => {
	it('stubs throw until real connectors land; factories can be swapped', () => {
		const src = { provider: 'google' } as CalendarSource;
		expect(() => createProvider(src)).toThrow(/Google/);
		expect(() => providerRegistry.icloud(src)).toThrow(/iCloud/);
		const orig = providerRegistry.google;
		const fake = new FakeProvider();
		providerRegistry.google = () => fake;
		expect(createProvider(src)).toBe(fake);
		providerRegistry.google = orig;
	});

	it('FakeProvider lists calendars and rejects unknown ones', async () => {
		const p = new FakeProvider({ a: [] });
		expect(await p.listCalendars()).toEqual([{ externalId: 'a', name: 'a' }]);
		await expect(p.fetchEvents('nope')).rejects.toThrow(/unknown/);
	});

	it('is disabled by HUB_CALENDAR_SYNC=off', () => {
		expect(startCalendarScheduler({ HUB_CALENDAR_SYNC: 'off' })).toBeUndefined();
	});
});
