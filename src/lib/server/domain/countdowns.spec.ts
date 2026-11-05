import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../db/index.js';
import { calendarSources, events } from '../db/schema.js';
import {
	createCountdown,
	createCountdownFromEvent,
	deleteCountdown,
	listCountdowns,
	unlinkCountdown,
	updateCountdown
} from './countdowns.js';

let db: Db;
beforeEach(() => {
	db = openDb(':memory:');
});

const code = (fn: () => unknown) => {
	try {
		fn();
	} catch (e) {
		return (e as { code: string }).code;
	}
	return 'none';
};

describe('countdown storage', () => {
	it('creates with a trimmed title and optional emoji', () => {
		const c = createCountdown(db, { title: '  Beach trip ', targetDate: '2026-12-01', icon: '🏖️' });
		expect(c).toMatchObject({ title: 'Beach trip', targetDate: '2026-12-01', icon: '🏖️' });
		expect(createCountdown(db, { title: 'x', targetDate: '2026-12-02', icon: '' }).icon).toBeNull();
	});
	it('rejects bad input', () => {
		expect(code(() => createCountdown(db, { title: ' ', targetDate: '2026-12-01' }))).toBe(
			'invalid'
		);
		expect(
			code(() => createCountdown(db, { title: 'a'.repeat(61), targetDate: '2026-12-01' }))
		).toBe('invalid');
		expect(code(() => createCountdown(db, { title: 'a', targetDate: '2026-02-30' }))).toBe(
			'invalid'
		);
		expect(
			code(() => createCountdown(db, { title: 'a', targetDate: '2026-12-01', icon: 'ab' }))
		).toBe('invalid');
	});
	it('lists soonest first, edits and deletes', () => {
		const a = createCountdown(db, { title: 'Later', targetDate: '2027-01-01' });
		createCountdown(db, { title: 'Sooner', targetDate: '2026-11-01' });
		expect(listCountdowns(db).map((c) => c.title)).toEqual(['Sooner', 'Later']);
		expect(updateCountdown(db, a.id, { targetDate: '2026-10-20' }).targetDate).toBe('2026-10-20');
		expect(updateCountdown(db, a.id, {})).toMatchObject({ title: 'Later' });
		expect(code(() => updateCountdown(db, 'nope', { title: 'x' }))).toBe('not_found');
		expect(deleteCountdown(db, a.id)).toEqual({ id: a.id });
		expect(code(() => deleteCountdown(db, a.id))).toBe('not_found');
		expect(listCountdowns(db)).toHaveLength(1);
	});
});

describe('countdowns from calendar events (CD-4)', () => {
	const addEvent = (id: string, externalId: string, startsAt: number, allDay = false) =>
		db
			.insert(events)
			.values({
				id,
				sourceId: 'src',
				externalId,
				title: 'School play',
				startsAt,
				endsAt: startsAt + 3_600_000,
				allDay
			})
			.run();
	beforeEach(() => {
		db.insert(calendarSources).values({ id: 'src', provider: 'ics', label: 'Family' }).run();
	});

	it('counts down to the household-local day the event starts on', () => {
		// 02:30 UTC on Nov 14 is still Nov 13 in Chicago.
		addEvent('e1', 'uid-1', Date.UTC(2026, 10, 14, 2, 30));
		const { countdown, created } = createCountdownFromEvent(db, 'e1', 'America/Chicago', '🎭');
		expect(created).toBe(true);
		expect(countdown).toMatchObject({
			title: 'School play',
			targetDate: '2026-11-13',
			icon: '🎭',
			eventSourceId: 'src',
			eventExternalId: 'uid-1'
		});
	});
	it('uses the stored date for all-day events', () => {
		addEvent('e2', 'uid-2', Date.UTC(2026, 10, 26), true);
		expect(createCountdownFromEvent(db, 'e2', 'America/Chicago').countdown.targetDate).toBe(
			'2026-11-26'
		);
	});
	it('makes one countdown per event', () => {
		addEvent('e1', 'uid-1', Date.UTC(2026, 10, 14, 18));
		const first = createCountdownFromEvent(db, 'e1', 'UTC').countdown;
		const again = createCountdownFromEvent(db, 'e1', 'UTC');
		expect(again).toEqual({ countdown: first, created: false });
		expect(listCountdowns(db)).toHaveLength(1);
	});
	it('rejects a missing or unknown event', () => {
		expect(code(() => createCountdownFromEvent(db, undefined, 'UTC'))).toBe('invalid');
		expect(code(() => createCountdownFromEvent(db, 'nope', 'UTC'))).toBe('not_found');
	});
	it('follows the event when it moves or is renamed, and keeps the date when it is deleted', () => {
		addEvent('e1', 'uid-1', Date.UTC(2026, 10, 14, 18));
		const { countdown } = createCountdownFromEvent(db, 'e1', 'UTC');
		// A re-sync replaces the row (new id) but keeps the external id.
		db.delete(events).run();
		addEvent('e9', 'uid-1', Date.UTC(2026, 10, 20, 18));
		db.update(events).set({ title: '  Spring play ' }).run();
		expect(listCountdowns(db, 'UTC')[0]).toMatchObject({
			id: countdown.id,
			title: 'Spring play',
			targetDate: '2026-11-20',
			eventMissing: false,
			eventId: 'e9'
		});
		db.delete(events).run();
		expect(listCountdowns(db, 'UTC')[0]).toMatchObject({
			title: 'Spring play',
			targetDate: '2026-11-20',
			eventMissing: true
		});
		const plain = unlinkCountdown(db, countdown.id);
		expect(plain.eventExternalId).toBeNull();
		expect(listCountdowns(db, 'UTC')[0].eventMissing).toBe(false);
		expect(code(() => unlinkCountdown(db, 'nope'))).toBe('not_found');
	});
	it('only the emoji of a linked countdown can be edited', () => {
		addEvent('e1', 'uid-1', Date.UTC(2026, 10, 14, 18));
		const { countdown } = createCountdownFromEvent(db, 'e1', 'UTC');
		expect(updateCountdown(db, countdown.id, { icon: '🎭' }).icon).toBe('🎭');
		expect(code(() => updateCountdown(db, countdown.id, { targetDate: '2026-12-01' }))).toBe(
			'invalid'
		);
	});
});
