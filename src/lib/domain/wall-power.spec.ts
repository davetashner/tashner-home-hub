import { describe, expect, it } from 'vitest';
import { describeWallPower, parseWallPower } from './wall-power.js';

const zone = 'America/Chicago';

describe('parseWallPower', () => {
	it('reads a power state', () => {
		expect(
			parseWallPower({ power: 'off', until: '2026-10-18T12:00:00.000Z', mode: 'off' })
		).toEqual({
			power: 'off',
			until: '2026-10-18T12:00:00.000Z',
			mode: 'off'
		});
		expect(parseWallPower({ power: 'on' })).toEqual({ power: 'on', until: null, mode: undefined });
	});
	it('rejects anything else', () => {
		expect(parseWallPower(null)).toBeNull();
		expect(parseWallPower('on')).toBeNull();
		expect(parseWallPower({ power: 'dim' })).toBeNull();
	});
});

describe('describeWallPower', () => {
	it('says when the screen is on until, in the household zone', () => {
		expect(describeWallPower({ power: 'on', until: '2026-10-19T02:30:00.000Z' }, zone)).toBe(
			'On until 9:30 PM'
		);
	});
	it('says when it is asleep until', () => {
		expect(describeWallPower({ power: 'off', until: '2026-10-18T12:00:00.000Z' }, zone)).toBe(
			'Asleep until 7:00 AM'
		);
	});
	it('handles no planned change', () => {
		expect(describeWallPower({ power: 'off' }, zone)).toBe('Asleep until someone wakes it');
		expect(describeWallPower({ power: 'on' }, zone)).toBe('On');
	});
	it('ignores an unreadable time', () => {
		expect(describeWallPower({ power: 'on', until: 'nope' }, zone)).toBe('On');
	});
	it('names the night clock', () => {
		expect(
			describeWallPower(
				{ power: 'on', mode: 'night-clock', until: '2026-10-18T12:00:00.000Z' },
				zone
			)
		).toBe('Night clock until 7:00 AM');
		expect(describeWallPower({ power: 'on', mode: 'night-clock' }, zone)).toBe('Night clock');
	});
});
