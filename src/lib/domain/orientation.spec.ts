import { describe, expect, it } from 'vitest';
import {
	displayOrientation,
	isRotation,
	orientationOf,
	parseRotationBody,
	resolveRotation
} from './orientation.js';

describe('orientation', () => {
	it('maps each transform to an orientation', () => {
		expect(orientationOf('normal')).toBe('landscape');
		expect(orientationOf('180')).toBe('landscape');
		expect(orientationOf('90')).toBe('portrait');
		expect(orientationOf('270')).toBe('portrait');
	});

	it('only accepts the four wlr-randr transforms', () => {
		for (const ok of ['normal', '90', '180', '270']) expect(isRotation(ok)).toBe(true);
		for (const bad of ['0', 90, 'flipped', null, undefined, ''])
			expect(isRotation(bad)).toBe(false);
	});

	it('falls back to normal for anything invalid', () => {
		expect(resolveRotation('270')).toBe('270');
		expect(resolveRotation('nope')).toBe('normal');
		expect(resolveRotation(undefined)).toBe('normal');
	});

	it('shapes the agent payload', () => {
		expect(displayOrientation('90')).toEqual({ rotation: '90', orientation: 'portrait' });
	});

	it('validates PUT bodies', () => {
		expect(parseRotationBody({ rotation: '180' })).toBe('180');
		expect(parseRotationBody({ rotation: 90 })).toEqual({
			error: expect.stringMatching(/rotation must be/)
		});
		expect(parseRotationBody({})).toEqual({ error: expect.stringMatching(/rotation must be/) });
	});
});
