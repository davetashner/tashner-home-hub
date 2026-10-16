import { describe, expect, it } from 'vitest';
import {
	approvedTransitions,
	inQuietHours,
	isAllDone,
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
	it('ignores an already-approved board and a first load', () => {
		const b = board(chore('a', 'approved'));
		expect(approvedTransitions(b, b)).toEqual({ count: 0, stars: 0 });
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
