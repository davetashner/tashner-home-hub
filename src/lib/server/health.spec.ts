import { describe, expect, it } from 'vitest';
import { healthReport } from './health';

describe('healthReport', () => {
	it('reports ok with whole-second uptime', () => {
		expect(healthReport('1.2.3', 42.9)).toEqual({
			status: 'ok',
			version: '1.2.3',
			uptimeSeconds: 42
		});
	});
});
