import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../db/index.js';
import { createMember } from './members.js';
import {
	activitiesForMember,
	createPracticeActivity,
	listPracticeActivities,
	updatePracticeActivity
} from './practice-activities.js';

let db: Db;
beforeEach(() => {
	db = openDb(':memory:');
});

const code = (fn: () => unknown) => {
	try {
		fn();
	} catch (e) {
		return (e as { code: string }).code;
	}
	return 'none';
};
const base = { name: 'Piano', minutesPerBlock: 10, starsPerBlock: 2, dailyStarCap: 6 };

describe('practice activities', () => {
	it('seeds Reading and Practice for every kid', () => {
		const list = listPracticeActivities(db);
		expect(list.map((a) => a.name)).toEqual(['Reading', 'Practice']);
		expect(list[0]).toMatchObject({
			minutesPerBlock: 15,
			starsPerBlock: 1,
			dailyStarCap: 4,
			memberIds: null,
			active: true
		});
	});
	it('creates after the last one, with a trimmed name and emoji', () => {
		const a = createPracticeActivity(db, { ...base, name: ' Piano ', emoji: '🎹' });
		expect(a).toMatchObject({ name: 'Piano', emoji: '🎹', sortOrder: 2, memberIds: null });
		expect(createPracticeActivity(db, { ...base, emoji: '' }).emoji).toBeNull();
	});
	it('rejects bad input', () => {
		const bad = (p: object) => code(() => createPracticeActivity(db, { ...base, ...p }));
		expect(bad({ name: ' ' })).toBe('invalid');
		expect(bad({ name: 'a'.repeat(41) })).toBe('invalid');
		expect(bad({ emoji: 'ab' })).toBe('invalid');
		expect(bad({ minutesPerBlock: 0 })).toBe('invalid');
		expect(bad({ minutesPerBlock: 1.5 })).toBe('invalid');
		expect(bad({ starsPerBlock: '2' })).toBe('invalid');
		expect(bad({ dailyStarCap: 101 })).toBe('invalid');
		expect(bad({ memberIds: [] })).toBe('invalid');
		expect(bad({ memberIds: ['nobody'] })).toBe('invalid');
		expect(bad({ memberIds: 'x' })).toBe('invalid');
		expect(bad({ active: 'yes' })).toBe('invalid');
		expect(bad({ sortOrder: -1 })).toBe('invalid');
	});
	it('scopes to chosen kids, never adults', () => {
		const ada = createMember(db, { name: 'Ada', role: 'child', color: 'member-1' });
		const bo = createMember(db, { name: 'Bo', role: 'child', color: 'member-2' });
		const mum = createMember(db, { name: 'Mum', role: 'adult', color: 'member-3' });
		expect(code(() => createPracticeActivity(db, { ...base, memberIds: [mum.id] }))).toBe(
			'invalid'
		);
		const piano = createPracticeActivity(db, { ...base, memberIds: [ada.id, ada.id] });
		expect(piano.memberIds).toEqual([ada.id]);
		expect(activitiesForMember(db, ada.id).map((a) => a.name)).toEqual([
			'Reading',
			'Practice',
			'Piano'
		]);
		expect(activitiesForMember(db, bo.id).map((a) => a.name)).toEqual(['Reading', 'Practice']);
		expect(activitiesForMember(db, mum.id)).toEqual([]);
		expect(activitiesForMember(db, 'nobody')).toEqual([]);
	});
	it('edits, deactivates and hides inactive from kids', () => {
		const ada = createMember(db, { name: 'Ada', role: 'child', color: 'member-1' });
		const a = createPracticeActivity(db, base);
		const edited = updatePracticeActivity(db, a.id, {
			name: 'Math facts',
			emoji: '➕',
			dailyStarCap: 3,
			active: false,
			memberIds: [ada.id],
			sortOrder: 9
		});
		expect(edited).toMatchObject({ name: 'Math facts', dailyStarCap: 3, active: false });
		expect(activitiesForMember(db, ada.id).map((x) => x.name)).not.toContain('Math facts');
		expect(updatePracticeActivity(db, a.id, { memberIds: null }).memberIds).toBeNull();
		expect(updatePracticeActivity(db, a.id, {}).name).toBe('Math facts');
		expect(code(() => updatePracticeActivity(db, 'nope', { name: 'x' }))).toBe('not_found');
		expect(code(() => updatePracticeActivity(db, a.id, { starsPerBlock: 0 }))).toBe('invalid');
	});
});
