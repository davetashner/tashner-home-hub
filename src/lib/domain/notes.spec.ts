import { describe, expect, it } from 'vitest';
import {
	NOTE_IMAGE_MAX_BYTES,
	NOTE_MAX,
	cleanNoteBody,
	compareNotes,
	expiryFor,
	isExpired,
	isNoteColor,
	isUntil,
	parseNoteImage,
	startOfDay,
	untilLabel,
	visibleNotes
} from './notes.js';

const note = (id: string, createdAt: number, pinned = false, expiresAt: number | null = null) => ({
	id,
	createdAt,
	pinned,
	expiresAt
});

describe('note text', () => {
	it('trims and bounds by characters', () => {
		expect(cleanNoteBody('  Milk please ')).toBe('Milk please');
		expect(cleanNoteBody('   ')).toBeNull();
		expect(cleanNoteBody(5)).toBeNull();
		expect(cleanNoteBody('a'.repeat(NOTE_MAX))).not.toBeNull();
		expect(cleanNoteBody('a'.repeat(NOTE_MAX + 1))).toBeNull();
		// An emoji is one character, not two UTF-16 units.
		expect(cleanNoteBody('🎉'.repeat(NOTE_MAX))).not.toBeNull();
	});
	it('knows colors and until choices', () => {
		expect(isNoteColor('note-pink')).toBe(true);
		expect(isNoteColor('red')).toBe(false);
		expect(isUntil('week')).toBe(true);
		expect(isUntil('year')).toBe(false);
	});
});

describe('expiry', () => {
	const noon = Date.parse('2027-03-10T12:00:00Z');
	it('ends at local midnight in the household zone', () => {
		expect(expiryFor(null, noon, 'UTC')).toBeNull();
		expect(expiryFor('today', noon, 'UTC')).toBe(Date.parse('2027-03-11T00:00:00Z'));
		expect(expiryFor('tomorrow', noon, 'UTC')).toBe(Date.parse('2027-03-12T00:00:00Z'));
		expect(expiryFor('week', noon, 'UTC')).toBe(Date.parse('2027-03-17T00:00:00Z'));
		// 03:00Z on the 11th is still the evening of the 10th in Chicago (UTC-6 in winter).
		const late = Date.parse('2027-03-11T03:00:00Z');
		expect(expiryFor('today', late, 'America/Chicago')).toBe(Date.parse('2027-03-11T06:00:00Z'));
	});
	it('rolls over month ends and survives a DST change', () => {
		expect(expiryFor('week', Date.parse('2027-01-28T12:00:00Z'), 'UTC')).toBe(
			Date.parse('2027-02-04T00:00:00Z')
		);
		// US spring-forward is 2027-03-14: the day after is UTC-5, so midnight is 05:00Z.
		expect(expiryFor('tomorrow', Date.parse('2027-03-13T18:00:00Z'), 'America/Chicago')).toBe(
			Date.parse('2027-03-15T05:00:00Z')
		);
		expect(startOfDay(2027, 3, 15, 'America/Chicago')).toBe(Date.parse('2027-03-15T05:00:00Z'));
	});
	it('expires at the boundary, never for null', () => {
		expect(isExpired({ expiresAt: 100 }, 99)).toBe(false);
		expect(isExpired({ expiresAt: 100 }, 100)).toBe(true);
		expect(isExpired({ expiresAt: null }, 1e15)).toBe(false);
	});
});

describe('ordering', () => {
	it('puts pinned first, then newest, then id', () => {
		const list = [note('a', 1), note('b', 3), note('c', 2, true), note('d', 3)];
		expect(list.sort(compareNotes).map((n) => n.id)).toEqual(['c', 'b', 'd', 'a']);
	});
	it('hides expired notes and keeps order', () => {
		const list = [note('old', 1, false, 50), note('new', 2), note('pin', 0, true, 500)];
		expect(visibleNotes(list, 100).map((n) => n.id)).toEqual(['pin', 'new']);
		expect(list).toHaveLength(3);
	});
});

describe('untilLabel', () => {
	const now = Date.parse('2027-03-10T12:00:00Z'); // a Wednesday
	it('describes the last day a note shows', () => {
		expect(untilLabel(null, now, 'UTC')).toBeNull();
		expect(untilLabel(now - 1, now, 'UTC')).toBeNull();
		expect(untilLabel(Date.parse('2027-03-11T00:00:00Z'), now, 'UTC')).toBe('Until tonight');
		expect(untilLabel(Date.parse('2027-03-12T00:00:00Z'), now, 'UTC')).toBe('Until Thu');
		expect(untilLabel(Date.parse('2027-03-17T00:00:00Z'), now, 'UTC')).toBe('Until Tue');
	});
});

describe('note images', () => {
	const PNG =
		'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
	it('decodes a small PNG data URL', () => {
		const bytes = parseNoteImage(PNG);
		expect(bytes?.length).toBeGreaterThan(8);
		expect(bytes?.[1]).toBe(0x50);
	});
	it('rejects anything else', () => {
		expect(parseNoteImage(undefined)).toBeNull();
		expect(parseNoteImage('data:image/jpeg;base64,AAAA')).toBeNull();
		expect(parseNoteImage('data:image/png;base64,not base64!')).toBeNull();
		expect(parseNoteImage('data:image/png;base64,AAA')).toBeNull(); // bad padding
		expect(parseNoteImage('data:image/png;base64,AAAAAAAAAAAA')).toBeNull(); // not a PNG
		expect(parseNoteImage('data:image/png;base64,AAAA')).toBeNull(); // too short
	});
	it('rejects an image over the limit', () => {
		const big = 'data:image/png;base64,' + 'A'.repeat(((NOTE_IMAGE_MAX_BYTES + 100) * 4) / 3);
		expect(parseNoteImage(big)).toBeNull();
		const bits = Buffer.alloc(NOTE_IMAGE_MAX_BYTES + 3);
		bits.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		expect(parseNoteImage('data:image/png;base64,' + bits.toString('base64'))).toBeNull();
	});
});
