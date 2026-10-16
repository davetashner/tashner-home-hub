import { describe, expect, it } from 'vitest';
import { isStorable, keysToEvict, pickFallback, routeKind, swEnabled } from './offline-cache';

const kind = (path: string, method = 'GET', nav = false) =>
	routeKind(method, new URL(path, 'http://hub.local'), nav);

describe('routeKind', () => {
	it('caches kid-visible API reads', () => {
		expect(kind('/api/members')).toBe('api');
		expect(kind('/api/members/abc/chores?date=2026-01-01')).toBe('api');
		expect(kind('/api/members/abc/stars?limit=1')).toBe('api');
		expect(kind('/api/members/abc/goal')).toBe('api');
		expect(kind('/api/calendar/events?start=1&end=2')).toBe('api');
		expect(kind('/api/calendar/status')).toBe('api');
		expect(kind('/api/approvals/count')).toBe('api');
	});

	it('keeps photos separate', () => {
		expect(kind('/api/photo/abc')).toBe('photo');
		expect(kind('/api/photo/slideshow?seed=x')).toBe('api');
		expect(kind('/api/settings/slideshow')).toBe('api');
	});

	it('never caches adult or unknown API routes', () => {
		expect(kind('/api/members/abc/pin')).toBe('other');
		expect(kind('/api/members/abc/bonus')).toBe('other');
		expect(kind('/api/backups')).toBe('other');
		expect(kind('/api/auth/pin')).toBe('other');
		expect(kind('/api/calendar/sources')).toBe('other');
	});

	it('never caches writes', () => {
		expect(kind('/api/members/abc/chores', 'POST')).toBe('other');
		expect(kind('/api/photo/abc', 'DELETE')).toBe('other');
	});

	it('caches child screens but not adult flows', () => {
		expect(kind('/', 'GET', true)).toBe('page');
		expect(kind('/chores', 'GET', true)).toBe('page');
		expect(kind('/calendar', 'GET', true)).toBe('page');
		expect(kind('/chores/__data.json')).toBe('page');
		expect(kind('/__data.json')).toBe('page');
		expect(kind('/settings', 'GET', true)).toBe('other');
		expect(kind('/settings/__data.json')).toBe('other');
		expect(kind('/setup', 'GET', true)).toBe('other');
		expect(kind('/unlock', 'GET', true)).toBe('other');
		expect(kind('/chores')).toBe('other');
	});
});

describe('isStorable', () => {
	const res = (status: number, redirected = false, cookie = false) => ({
		status,
		redirected,
		headers: { has: (n: string) => cookie && n === 'set-cookie' }
	});
	it('accepts plain 200s only', () => {
		expect(isStorable(res(200))).toBe(true);
		expect(isStorable(res(404))).toBe(false);
		expect(isStorable(res(200, true))).toBe(false);
		expect(isStorable(res(200, false, true))).toBe(false);
	});
});

describe('keysToEvict', () => {
	it('evicts the oldest beyond the cap', () => {
		expect(keysToEvict([1, 2, 3, 4], 2)).toEqual([1, 2]);
		expect(keysToEvict([1, 2], 2)).toEqual([]);
	});
});

describe('swEnabled', () => {
	const headless = 'Mozilla/5.0 HeadlessChrome/120.0';
	const headed = 'Mozilla/5.0 Chrome/120.0';
	it('is off only for headless automation by default', () => {
		expect(swEnabled(headless, null)).toBe(false);
		expect(swEnabled(headed, null)).toBe(true);
	});
	it('lets hub.sw force either way', () => {
		expect(swEnabled(headless, 'on')).toBe(true);
		expect(swEnabled(headed, 'off')).toBe(false);
		expect(swEnabled(headed, 'other')).toBe(true);
	});
});

describe('pickFallback', () => {
	const keys = [
		'http://h/api/calendar/events?start=1&end=2',
		'http://h/api/members/a/chores?date=2026-01-01',
		'http://h/api/calendar/events?start=3&end=4'
	];
	it('picks the newest copy with the same path', () => {
		expect(pickFallback(keys, 'http://h/api/calendar/events?start=9&end=10')).toBe(keys[2]);
		expect(pickFallback(keys, 'http://h/api/members/a/chores?date=2026-01-02')).toBe(keys[1]);
	});
	it('returns null when the path was never saved', () => {
		expect(pickFallback(keys, 'http://h/api/members/b/chores?date=x')).toBeNull();
	});
});
