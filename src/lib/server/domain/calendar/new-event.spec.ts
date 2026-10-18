import { describe, expect, it } from 'vitest';
import { NewEventError, resolveNewEvent } from './new-event.js';

const ok = { title: ' Soccer ', allDay: false, start: '2026-10-20T17:00', end: '2026-10-20T18:30' };
const bad = (patch: Record<string, unknown>, zone = 'America/New_York') =>
	expect(() => resolveNewEvent({ ...ok, ...patch }, zone)).toThrow(NewEventError);

describe('resolveNewEvent', () => {
	it('resolves household wall time to instants and trims text', () => {
		const e = resolveNewEvent({ ...ok, location: ' Park ', notes: '  ' }, 'America/New_York');
		expect(e).toEqual({
			title: 'Soccer',
			location: 'Park',
			time: {
				allDay: false,
				startMs: Date.UTC(2026, 9, 20, 21),
				endMs: Date.UTC(2026, 9, 20, 22, 30)
			}
		});
	});
	it('makes the all-day end exclusive', () => {
		const e = resolveNewEvent(
			{ title: 'Trip', allDay: true, start: '2026-12-30', end: '2026-12-31' },
			'UTC'
		);
		expect(e.time).toEqual({ allDay: true, startDate: '2026-12-30', endDate: '2027-01-01' });
	});
	it('accepts a single all-day date', () => {
		const e = resolveNewEvent(
			{ title: 'x', allDay: true, start: '2026-02-28', end: '2026-02-28' },
			'UTC'
		);
		expect(e.time).toMatchObject({ endDate: '2026-03-01' });
	});
	it('rejects bad input', () => {
		bad({ title: '' });
		bad({ title: '   ' });
		bad({ title: 5 });
		bad({ title: 'x'.repeat(201) });
		bad({ allDay: 'yes' });
		bad({ end: '2026-10-20T17:00' });
		bad({ end: '2026-10-20T16:00' });
		bad({ start: '2026-02-31T10:00' });
		bad({ start: 'nope' });
		bad({ start: 5 });
		bad({ end: '2030-10-20T18:00' });
		bad({ location: 5 });
		bad({ notes: 'x'.repeat(2001) });
		bad({ allDay: true, start: '2026-10-21', end: '2026-10-20' });
		bad({ allDay: true, start: '2026-02-30', end: '2026-03-01' });
		bad({ allDay: true, start: 5, end: '2026-03-01' });
		bad({ allDay: true, start: '2026-01-01', end: '2028-01-01' });
	});
});
