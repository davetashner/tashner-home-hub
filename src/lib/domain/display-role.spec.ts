import { describe, expect, it } from 'vitest';
import {
	defaultRemember,
	hasKioskBehaviour,
	isDisplayRole,
	parseDisplayRole,
	readDisplayParam
} from './display-role.js';

describe('display role', () => {
	it('defaults to personal unless explicitly wall', () => {
		expect(parseDisplayRole(undefined)).toBe('personal');
		expect(parseDisplayRole('junk')).toBe('personal');
		expect(parseDisplayRole('wall')).toBe('wall');
		expect(parseDisplayRole('personal')).toBe('personal');
	});

	it('validates roles', () => {
		expect(isDisplayRole('wall')).toBe(true);
		expect(isDisplayRole('personal')).toBe(true);
		expect(isDisplayRole('tv')).toBe(false);
		expect(isDisplayRole(1)).toBe(false);
	});

	it('remembers by default only on personal devices', () => {
		expect(defaultRemember('personal')).toBe(true);
		expect(defaultRemember('wall')).toBe(false);
	});

	it('gives only walls the kiosk behaviour', () => {
		expect(hasKioskBehaviour('wall')).toBe(true);
		expect(hasKioskBehaviour('personal')).toBe(false);
	});

	it('reads the launch parameter and strips it from the redirect target', () => {
		expect(readDisplayParam(new URL('http://h/?display=wall'))).toEqual({
			role: 'wall',
			location: '/'
		});
		expect(readDisplayParam(new URL('http://h/chores?a=1&display=personal#x'))).toEqual({
			role: 'personal',
			location: '/chores?a=1#x'
		});
		expect(readDisplayParam(new URL('http://h/?display=tv'))).toBeNull();
		expect(readDisplayParam(new URL('http://h/'))).toBeNull();
	});
});
