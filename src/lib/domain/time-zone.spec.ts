import { describe, expect, it } from 'vitest';
import {
	COMMON_ZONES,
	canonicalZone,
	defaultTimeZone,
	isTimeZone,
	listTimeZones,
	offsetLabel,
	resolveTimeZone,
	runtimeZone,
	searchZones,
	zoneLabel
} from './time-zone';

describe('canonicalZone', () => {
	it('accepts IANA names and returns the canonical spelling', () => {
		expect(canonicalZone('America/Chicago')).toBe('America/Chicago');
		expect(canonicalZone('america/new_york')).toBe('America/New_York');
		expect(canonicalZone('Etc/GMT+5')).toBe('Etc/GMT+5');
		expect(canonicalZone('UTC')).toBe('UTC');
		expect(canonicalZone('America/North_Dakota/New_Salem')).toBe('America/North_Dakota/New_Salem');
	});

	it('rejects non-strings, raw offsets, unknown and oversized names', () => {
		for (const v of [undefined, null, 5, '', '+05:00', '-0800', 'Mars/Olympus', 'a/'.repeat(40)])
			expect(canonicalZone(v)).toBeNull();
		expect(isTimeZone('Europe/Paris')).toBe(true);
		expect(isTimeZone('Nowhere')).toBe(false);
	});
});

describe('defaultTimeZone', () => {
	it('prefers TZ, accepting the POSIX leading colon', () => {
		expect(defaultTimeZone('Europe/Paris', () => 'UTC')).toBe('Europe/Paris');
		expect(defaultTimeZone(':Asia/Tokyo', () => 'UTC')).toBe('Asia/Tokyo');
	});

	it('falls back to the runtime zone, then UTC', () => {
		expect(defaultTimeZone(undefined, () => 'America/Denver')).toBe('America/Denver');
		expect(defaultTimeZone('bogus', () => 'America/Denver')).toBe('America/Denver');
		expect(defaultTimeZone('', () => 'also bogus')).toBe('UTC');
		expect(isTimeZone(defaultTimeZone())).toBe(true);
		expect(isTimeZone(runtimeZone())).toBe(true);
	});
});

it('resolveTimeZone keeps a valid stored zone and otherwise uses the fallback', () => {
	expect(resolveTimeZone('pacific/honolulu', 'UTC')).toBe('Pacific/Honolulu');
	expect(resolveTimeZone(null, 'Europe/London')).toBe('Europe/London');
	expect(resolveTimeZone('Mars/Olympus', 'Europe/London')).toBe('Europe/London');
});

describe('listTimeZones', () => {
	it('lists every runtime zone, sorted, with UTC', () => {
		const zones = listTimeZones();
		expect(zones).toContain('UTC');
		expect(zones).toContain('America/Chicago');
		expect(zones).toEqual([...zones].sort());
		expect(new Set(zones).size).toBe(zones.length);
	});

	it('falls back to the common list when the runtime cannot list zones', () => {
		const zones = listTimeZones(() => {
			throw new Error('unsupported');
		});
		expect(zones).toEqual([...COMMON_ZONES].sort());
	});
});

describe('searchZones', () => {
	const zones = listTimeZones();

	it('shows the common zones before anything is typed', () => {
		expect(searchZones(zones, '  ')).toEqual([...COMMON_ZONES]);
		expect(searchZones(zones, '', 3)).toHaveLength(3);
	});

	it('matches every typed word, ignoring case, slashes and underscores', () => {
		expect(searchZones(zones, 'new york')).toEqual(['America/New_York']);
		expect(searchZones(zones, 'EUROPE par')).toEqual(['Europe/Paris']);
		expect(searchZones(zones, 'new_salem')).toEqual(['America/North_Dakota/New_Salem']);
		expect(searchZones(zones, 'zzzz')).toEqual([]);
		expect(searchZones(zones, 'america', 5)).toHaveLength(5);
	});
});

it('zoneLabel splits a zone into city and region', () => {
	expect(zoneLabel('America/Argentina/Buenos_Aires')).toEqual({
		city: 'Buenos Aires',
		region: 'America · Argentina'
	});
	expect(zoneLabel('UTC')).toEqual({ city: 'UTC', region: '' });
});

describe('offsetLabel follows daylight saving', () => {
	it('around the US spring-forward and fall-back edges', () => {
		// 2026-03-08 02:00 CST -> 03:00 CDT (08:00 UTC); 2026-11-01 02:00 CDT -> 01:00 CST (07:00 UTC).
		expect(offsetLabel('America/Chicago', Date.UTC(2026, 2, 8, 7, 59))).toBe('UTC−6');
		expect(offsetLabel('America/Chicago', Date.UTC(2026, 2, 8, 8, 0))).toBe('UTC−5');
		expect(offsetLabel('America/Chicago', Date.UTC(2026, 10, 1, 6, 59))).toBe('UTC−5');
		expect(offsetLabel('America/Chicago', Date.UTC(2026, 10, 1, 7, 0))).toBe('UTC−6');
	});

	it('handles half hours, the southern hemisphere and UTC', () => {
		expect(offsetLabel('Asia/Kolkata', Date.UTC(2026, 0, 1))).toBe('UTC+5:30');
		expect(offsetLabel('Australia/Sydney', Date.UTC(2026, 0, 1))).toBe('UTC+11');
		expect(offsetLabel('Australia/Sydney', Date.UTC(2026, 6, 1))).toBe('UTC+10');
		expect(offsetLabel('UTC', Date.UTC(2026, 6, 1))).toBe('UTC');
	});
});
