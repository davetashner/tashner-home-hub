import { describe, expect, it } from 'vitest';
import { WINDOWS_ZONES, windowsToIana } from './windows-zones.js';

describe('windowsToIana', () => {
	it('maps common Windows names', () => {
		expect(windowsToIana('Eastern Standard Time')).toBe('America/New_York');
		expect(windowsToIana('Pacific Standard Time')).toBe('America/Los_Angeles');
		expect(windowsToIana('US Mountain Standard Time')).toBe('America/Phoenix');
		expect(windowsToIana('AUS Eastern Standard Time')).toBe('Australia/Sydney');
	});

	it('ignores case, spacing and quotes', () => {
		expect(windowsToIana('  "central standard time" ')).toBe('America/Chicago');
	});

	it('returns undefined for unknown names', () => {
		expect(windowsToIana('Narnia Standard Time')).toBeUndefined();
	});

	it('only maps to zones this runtime understands', () => {
		for (const iana of Object.values(WINDOWS_ZONES)) {
			expect(() => new Intl.DateTimeFormat('en-US', { timeZone: iana })).not.toThrow();
		}
	});
});
