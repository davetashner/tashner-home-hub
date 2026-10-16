import { describe, expect, it } from 'vitest';
import { formatClock } from './clock';

const instant = new Date('2026-10-16T19:07:00Z');

describe('formatClock', () => {
	it('formats 12-hour time and a long date in the given time zone', () => {
		const clock = formatClock(instant, { timeZone: 'America/New_York' });
		expect(clock.time).toBe('3:07 PM');
		expect(clock.date).toBe('Friday, October 16');
	});

	it('supports a 24-hour clock', () => {
		const clock = formatClock(instant, { timeZone: 'UTC', hour12: false });
		expect(clock.time).toBe('19:07');
	});

	it('defaults to en-US formatting', () => {
		const clock = formatClock(instant);
		expect(clock.time).toMatch(/^\d{1,2}:\d{2}\s?(AM|PM)$/);
	});
});
