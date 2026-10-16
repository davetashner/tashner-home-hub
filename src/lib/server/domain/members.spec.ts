import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb, schema, type Db } from '../db/index.js';
import { seedMembers } from '../dev/seed.js';
import {
	createMember,
	deleteMember,
	getMember,
	listMembers,
	MemberError,
	updateMember
} from './members.js';

let db: Db;
beforeEach(() => {
	db = openDb(':memory:');
});

function code(fn: () => unknown): string | undefined {
	try {
		fn();
	} catch (e) {
		return e instanceof MemberError ? e.code : 'other';
	}
	return undefined;
}

const base = { name: 'Sam', role: 'adult', color: 'member-2' } as const;

describe('createMember', () => {
	it('trims the name and stores an emoji avatar', () => {
		const m = createMember(db, { ...base, name: '  Sam  ', avatar: '🦊' });
		expect(m).toMatchObject({ name: 'Sam', avatar: '🦊', hasPin: false, color: 'member-2' });
		expect(getMember(db, m.id)).toEqual(m);
	});

	it('accepts multi-codepoint emoji as one grapheme and treats empty avatar as null', () => {
		expect(createMember(db, { ...base, avatar: '👩‍🚀' }).avatar).toBe('👩‍🚀');
		expect(createMember(db, { ...base, avatar: '' }).avatar).toBeNull();
		expect(createMember(db, { ...base }).avatar).toBeNull();
	});

	it.each([
		['empty name', { name: '   ' }],
		['long name', { name: 'x'.repeat(41) }],
		['non-string name', { name: 5 as unknown as string }],
		['bad role', { role: 'pet' as 'adult' }],
		['raw color', { color: '#ff0000' }],
		['unknown token', { color: 'member-7' }],
		['text avatar', { avatar: 'ab' }],
		['two emoji', { avatar: '🦊🐢' }],
		['single non-emoji letter', { avatar: 'a' }],
		['non-string avatar', { avatar: 3 as unknown as string }]
	])('rejects %s', (_label, patch) => {
		expect(code(() => createMember(db, { ...base, ...patch }))).toBe('validation');
	});

	it('accepts a 40-char name', () => {
		expect(createMember(db, { ...base, name: 'x'.repeat(40) }).name).toHaveLength(40);
	});
});

describe('list/get', () => {
	it('lists seeded members and never exposes pinHash', () => {
		const [a] = seedMembers(db);
		db.update(schema.members)
			.set({ pinHash: 'secret-hash' })
			.where(eq(schema.members.id, a.id))
			.run();
		const all = listMembers(db);
		expect(all).toHaveLength(3);
		expect(all.find((m) => m.id === a.id)?.hasPin).toBe(true);
		expect(JSON.stringify([all, getMember(db, a.id)])).not.toContain('secret-hash');
		expect(JSON.stringify(all)).not.toContain('pinHash');
	});

	it('returns null for unknown id', () => {
		expect(getMember(db, 'nope')).toBeNull();
	});
});

describe('updateMember', () => {
	it('patches fields and validates them', () => {
		const [a, b] = seedMembers(db);
		expect(
			updateMember(db, b.id, { name: ' Renamed ', color: 'member-6', avatar: null })
		).toMatchObject({
			name: 'Renamed',
			color: 'member-6',
			avatar: null
		});
		expect(updateMember(db, a.id, {})).toEqual(getMember(db, a.id));
		expect(code(() => updateMember(db, a.id, { color: 'red' }))).toBe('validation');
		expect(code(() => updateMember(db, 'nope', { name: 'x' }))).toBe('not_found');
	});

	it('refuses to demote the last adult but allows it with another adult', () => {
		const [a, b] = seedMembers(db);
		updateMember(db, b.id, { role: 'child' });
		expect(code(() => updateMember(db, a.id, { role: 'child' }))).toBe('last_adult');
		expect(updateMember(db, b.id, { role: 'adult' }).role).toBe('adult');
		expect(updateMember(db, a.id, { role: 'child' }).role).toBe('child');
	});
});

describe('deleteMember', () => {
	it('requires explicit confirmation', () => {
		const [, , kid] = seedMembers(db);
		expect(code(() => deleteMember(db, kid.id, { confirm: false }))).toBe('confirm_required');
		expect(getMember(db, kid.id)).not.toBeNull();
	});

	it('cascades to dependent rows', () => {
		const [, , kid] = seedMembers(db);
		db.insert(schema.starTransactions)
			.values({ id: 't1', memberId: kid.id, delta: 3, reason: 'bonus' })
			.run();
		deleteMember(db, kid.id, { confirm: true });
		expect(getMember(db, kid.id)).toBeNull();
		expect(db.select().from(schema.starTransactions).all()).toHaveLength(0);
	});

	it('protects the last adult and reports unknown ids', () => {
		const [a, b, kid] = seedMembers(db);
		deleteMember(db, b.id, { confirm: true });
		expect(code(() => deleteMember(db, a.id, { confirm: true }))).toBe('last_adult');
		deleteMember(db, kid.id, { confirm: true });
		expect(code(() => deleteMember(db, 'nope', { confirm: true }))).toBe('not_found');
	});
});
