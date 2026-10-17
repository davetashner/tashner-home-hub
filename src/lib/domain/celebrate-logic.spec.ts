import { describe, expect, it } from 'vitest';
import {
	approvedTransitions,
	inQuietHours,
	isAllDone,
	parseSoundSettings,
	shouldPlaySound,
	soundAllowed,
	DEFAULT_SOUND
} from './celebrate-logic.js';
import type { KidChore, KidGroup, Status } from './kid-chores.js';

const chore = (id: string, status: Status, stars = 1): KidChore => ({
	id,
	title: id,
	icon: null,
	stars,
	status,
	completionId: null
});
const board = (...c: KidChore[]): KidGroup[] => [{ timeOfDay: 'morning', chores: c }];

describe('approvedTransitions', () => {
	it('counts pending to approved only', () => {
		const before = board(chore('a', 'pending', 2), chore('b', 'pending'), chore('c', 'none'));
		const after = board(chore('a', 'approved', 2), chore('b', 'pending'), chore('c', 'approved'));
		expect(approvedTransitions(before, after)).toEqual({ count: 1, stars: 2 });
	});
	it('ignores a first load', () => {
		const b = board(chore('a', 'approved'));
		expect(approvedTransitions(undefined, b)).toEqual({ count: 0, stars: 0 });
	});
});

describe('isAllDone', () => {
	it('needs at least one chore, all pending or approved', () => {
		expect(isAllDone([])).toBe(false);
		expect(isAllDone(board(chore('a', 'pending'), chore('b', 'approved')))).toBe(true);
		expect(isAllDone(board(chore('a', 'pending'), chore('b', 'none')))).toBe(false);
		expect(isAllDone(board(chore('a', 'rejected')))).toBe(false);
	});
});

describe('quiet hours', () => {
	it('wraps midnight', () => {
		expect(inQuietHours(21 * 60, '20:00', '07:00')).toBe(true);
		expect(inQuietHours(3 * 60, '20:00', '07:00')).toBe(true);
		expect(inQuietHours(12 * 60, '20:00', '07:00')).toBe(false);
		expect(inQuietHours(7 * 60, '20:00', '07:00')).toBe(false);
	});
	it('handles same-day windows and bad input', () => {
		expect(inQuietHours(13 * 60, '12:00', '14:00')).toBe(true);
		expect(inQuietHours(15 * 60, '12:00', '14:00')).toBe(false);
		expect(inQuietHours(60, 'nope', '07:00')).toBe(false);
		expect(inQuietHours(60, '25:00', '07:00')).toBe(false);
		expect(inQuietHours(60, '08:00', '08:00')).toBe(false);
	});
	it('muted always wins', () => {
		expect(soundAllowed({ ...DEFAULT_SOUND, muted: true }, 12 * 60)).toBe(false);
		expect(soundAllowed(DEFAULT_SOUND, 12 * 60)).toBe(true);
		expect(soundAllowed(DEFAULT_SOUND, 22 * 60)).toBe(false);
	});
});

describe('shouldPlaySound (household zone)', () => {
	const night = {
		...DEFAULT_SOUND,
		quietStart: '22:00',
		quietEnd: '06:00',
		timeZone: 'Asia/Tokyo'
	};
	// 2026-10-17 14:30 UTC is 23:30 in Tokyo; 03:00 UTC is noon there.
	const lateInTokyo = Date.UTC(2026, 9, 17, 14, 30);
	const noonInTokyo = Date.UTC(2026, 9, 17, 3, 0);

	it('reads quiet hours in the household zone, not the browser zone', () => {
		expect(shouldPlaySound(night, lateInTokyo)).toBe(false);
		expect(shouldPlaySound(night, noonInTokyo)).toBe(true);
	});
	it('handles windows that cross midnight on both sides', () => {
		expect(shouldPlaySound(night, Date.UTC(2026, 9, 16, 13, 0))).toBe(false); // 22:00 sharp
		expect(shouldPlaySound(night, Date.UTC(2026, 9, 16, 20, 59))).toBe(false); // 05:59
		expect(shouldPlaySound(night, Date.UTC(2026, 9, 16, 21, 0))).toBe(true); // 06:00 sharp
	});
	it('follows daylight saving in the zone', () => {
		const chicago = { ...night, timeZone: 'America/Chicago' };
		expect(shouldPlaySound(chicago, Date.UTC(2026, 6, 1, 3, 30))).toBe(false); // 22:30 CDT
		expect(shouldPlaySound(chicago, Date.UTC(2026, 11, 1, 3, 30))).toBe(true); // 21:30 CST
	});
	it('falls back to the runtime zone for a missing or bad zone', () => {
		const t = Date.UTC(2026, 9, 17, 14, 30);
		const local = shouldPlaySound({ ...night, timeZone: undefined }, t);
		expect(shouldPlaySound({ ...night, timeZone: 'Not/AZone' }, t)).toBe(local);
	});
	it('is silent when muted or at volume 0, whatever the time', () => {
		expect(shouldPlaySound({ ...night, muted: true }, noonInTokyo)).toBe(false);
		expect(shouldPlaySound({ ...night, volume: 0 }, noonInTokyo)).toBe(false);
	});
});

describe('parseSoundSettings theme, volume and zone', () => {
	it('keeps valid values and defaults the rest', () => {
		expect(
			parseSoundSettings({ theme: 'arcade', volume: 40.4, timeZone: 'Asia/Tokyo' })
		).toMatchObject({
			theme: 'arcade',
			volume: 40,
			timeZone: 'Asia/Tokyo'
		});
		const bad = parseSoundSettings({ theme: 'x', volume: 'loud', timeZone: 'nope' });
		expect(bad).toEqual(DEFAULT_SOUND);
		expect(parseSoundSettings({ volume: 900 }).volume).toBe(100);
		expect(parseSoundSettings({ volume: -5 }).volume).toBe(0);
	});
});
