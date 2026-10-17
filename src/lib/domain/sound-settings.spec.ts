import { describe, expect, it } from 'vitest';
import {
	fromMinutes,
	isHhmm,
	parseSoundPatch,
	quietSummary,
	stepTime,
	timeLabel,
	toMinutes
} from './sound-settings.js';

describe('isHhmm', () => {
	it('accepts strict 24-hour times', () => {
		for (const t of ['00:00', '07:00', '19:45', '23:59']) expect(isHhmm(t)).toBe(true);
	});
	it('rejects anything else', () => {
		for (const t of ['7:00', '24:00', '12:60', '12:5', ' 12:00', '12:00 ', 'noon', 1200, null])
			expect(isHhmm(t)).toBe(false);
	});
});

describe('minutes', () => {
	it('converts both ways', () => {
		expect(toMinutes('20:15')).toBe(1215);
		expect(toMinutes('bad')).toBeNull();
		expect(fromMinutes(1215)).toBe('20:15');
	});
	it('wraps into one day', () => {
		expect(fromMinutes(24 * 60)).toBe('00:00');
		expect(fromMinutes(-15)).toBe('23:45');
	});
});

describe('stepTime', () => {
	it('moves a quarter hour each way', () => {
		expect(stepTime('20:00', 1)).toBe('20:15');
		expect(stepTime('20:00', -1)).toBe('19:45');
	});
	it('wraps around midnight', () => {
		expect(stepTime('23:45', 1)).toBe('00:00');
		expect(stepTime('00:00', -1)).toBe('23:45');
	});
	it('snaps an off-grid time to the next quarter hour', () => {
		expect(stepTime('20:07', 1)).toBe('20:15');
		expect(stepTime('20:07', -1)).toBe('20:00');
	});
	it('takes a custom step and treats a bad time as midnight', () => {
		expect(stepTime('20:00', 1, 30)).toBe('20:30');
		expect(stepTime('oops', 1)).toBe('00:15');
	});
});

describe('timeLabel', () => {
	it('reads as a 12-hour clock', () => {
		expect(timeLabel('20:00')).toBe('8:00 PM');
		expect(timeLabel('07:30')).toBe('7:30 AM');
		expect(timeLabel('00:15')).toBe('12:15 AM');
		expect(timeLabel('12:45')).toBe('12:45 PM');
	});
	it('handles midnight and noon', () => {
		expect(timeLabel('00:00')).toBe('12:00 AM');
		expect(timeLabel('12:00')).toBe('12:00 PM');
	});
	it('passes bad input through', () => {
		expect(timeLabel('oops')).toBe('oops');
	});
});

describe('quietSummary', () => {
	it('notes a window that runs overnight', () => {
		expect(quietSummary('20:00', '07:00')).toBe(
			'No sounds from 8:00 PM until 7:00 AM the next morning.'
		);
	});
	it('describes a same-day window', () => {
		expect(quietSummary('13:00', '15:00')).toBe('No sounds from 1:00 PM until 3:00 PM.');
	});
	it('says when there are no quiet hours', () => {
		expect(quietSummary('07:00', '07:00')).toMatch(/^No quiet hours/);
		expect(quietSummary('bad', '07:00')).toMatch(/^No quiet hours/);
	});
});

describe('parseSoundPatch', () => {
	it('keeps valid fields and ignores unknown ones', () => {
		expect(parseSoundPatch({ muted: true, quietStart: '21:00', quietEnd: '06:30', x: 1 })).toEqual({
			muted: true,
			quietStart: '21:00',
			quietEnd: '06:30'
		});
		expect(parseSoundPatch({})).toEqual({});
	});
	it('rejects a non-boolean muted', () => {
		expect(parseSoundPatch({ muted: 'yes' })).toBe('muted must be true or false');
	});
	it('rejects a malformed time', () => {
		expect(parseSoundPatch({ quietEnd: '7:00' })).toMatch(/^quietEnd must be/);
		expect(parseSoundPatch({ quietStart: '25:00' })).toMatch(/^quietStart must be/);
	});
});

describe('parseSoundPatch theme and volume', () => {
	it('accepts a known theme and a whole-number volume', () => {
		expect(parseSoundPatch({ theme: 'gentle', volume: 0 })).toEqual({ theme: 'gentle', volume: 0 });
	});
	it('rejects unknown themes and bad volumes', () => {
		expect(typeof parseSoundPatch({ theme: 'loud' })).toBe('string');
		for (const volume of [101, -1, 5.5, '50', null]) {
			expect(typeof parseSoundPatch({ volume })).toBe('string');
		}
	});
});
