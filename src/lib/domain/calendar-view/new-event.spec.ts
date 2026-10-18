import { describe, expect, it } from 'vitest';
import {
	clock,
	clockLabel,
	draftError,
	newDraft,
	overlaps,
	pendingEvent,
	setDate,
	setEnd,
	setEndDate,
	setStart,
	toRequest
} from './new-event.js';

const base = { ...newDraft('2026-10-20', 9 * 60 + 10, 'cal-1'), title: ' Piano ' };

describe('new event draft', () => {
	it('starts at the next whole hour for an hour', () => {
		expect([base.startMin, base.endMin]).toEqual([600, 660]);
		expect(newDraft('2026-10-20', 23 * 60 + 50, 'c').startMin).toBeLessThan(24 * 60 - 30);
	});

	it('moves the start and keeps the length, clamped to the day', () => {
		const d = setStart(base, 14 * 60 + 7);
		expect([d.startMin, d.endMin]).toEqual([14 * 60, 15 * 60]);
		const late = setStart(base, 23 * 60 + 45);
		expect(late.startMin).toBe(23 * 60 + 30);
		expect(late.endMin).toBe(23 * 60 + 45);
		expect(setStart(base, -50).startMin).toBe(0);
	});

	it('keeps the end after the start', () => {
		expect(setEnd(base, 0).endMin).toBe(base.startMin + 15);
		expect(setEnd(base, 20 * 60).endMin).toBe(20 * 60);
		expect(setEnd(base, 99999).endMin).toBe(23 * 60 + 45);
	});

	it('moves dates, keeping the span', () => {
		const multi = setEndDate({ ...base, allDay: true }, '2026-10-22');
		const moved = setDate(multi, '2026-11-01');
		expect([moved.date, moved.endDate]).toEqual(['2026-11-01', '2026-11-03']);
		expect(setEndDate(base, '2026-10-01').endDate).toBe('2026-10-20');
	});

	it('formats clocks', () => {
		expect(clock(65)).toBe('01:05');
		expect(clockLabel(0)).toBe('12:00 AM');
		expect(clockLabel(13 * 60 + 5)).toBe('1:05 PM');
		expect(clockLabel(12 * 60)).toBe('12:00 PM');
	});

	it('validates', () => {
		expect(draftError(base)).toBeNull();
		expect(draftError({ ...base, title: '  ' })).toMatch(/title/);
		expect(draftError({ ...base, title: 'x'.repeat(201) })).toMatch(/200/);
		expect(draftError({ ...base, calendarId: '' })).toMatch(/calendar/);
	});

	it('builds the request body', () => {
		expect(toRequest({ ...base, location: ' Hall ' })).toEqual({
			calendarId: 'cal-1',
			title: 'Piano',
			allDay: false,
			start: '2026-10-20T10:00',
			end: '2026-10-20T11:00',
			location: 'Hall'
		});
		const allDay = toRequest({ ...base, allDay: true, endDate: '2026-10-21', notes: 'n' });
		expect(allDay).toMatchObject({
			allDay: true,
			start: '2026-10-20',
			end: '2026-10-21',
			notes: 'n'
		});
	});

	it('builds pending events', () => {
		const timed = pendingEvent(base, 'America/New_York', 'p1');
		expect(timed).toMatchObject({ pending: true, allDay: false, title: 'Piano', members: [] });
		expect(timed.startsAt).toBe(Date.UTC(2026, 9, 20, 14));
		expect(timed.endsAt).toBe(Date.UTC(2026, 9, 20, 15));
		const all = pendingEvent({ ...base, allDay: true, endDate: '2026-10-21' }, 'UTC', 'p2');
		expect([all.startsAt, all.endsAt]).toEqual([Date.UTC(2026, 9, 20), Date.UTC(2026, 9, 22)]);
	});

	it('tests window overlap', () => {
		const ev = pendingEvent(base, 'UTC', 'p');
		expect(overlaps(ev, ev.startsAt - 10, ev.startsAt + 10)).toBe(true);
		expect(overlaps(ev, ev.endsAt, ev.endsAt + 10)).toBe(false);
	});
});
