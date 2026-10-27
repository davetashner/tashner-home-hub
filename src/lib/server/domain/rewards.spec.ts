import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, schema, type Db } from '../db/index.js';
import { redeemReward } from './redemptions.js';
import {
	LedgerError,
	approveCompletion,
	awardBonus,
	completeChore,
	createChore
} from './ledger.js';
import {
	archiveReward,
	OWN_GOALS_MAX,
	createOwnGoal,
	createReward,
	getGoal,
	isKidSelfServe,
	kidMayPickGoal,
	listGoals,
	listRewards,
	removeGoal,
	setGoal,
	updateReward
} from './rewards.js';

let db: Db;
const code = (fn: () => unknown) => {
	try {
		fn();
	} catch (e) {
		return (e as LedgerError).code;
	}
	return 'none';
};

beforeEach(() => {
	db = openDb(':memory:');
	for (const id of ['kid', 'sib'])
		db.insert(schema.members).values({ id, name: id, role: 'child', color: 'blue' }).run();
});

describe('reward validation', () => {
	it('accepts valid rewards and trims the title', () => {
		const r = createReward(db, { title: '  Ice cream  ', cost: 20, image: '🍦' });
		expect(r).toMatchObject({ title: 'Ice cream', cost: 20, image: '🍦', active: true });
		expect(createReward(db, { title: 'x', cost: 10_000 }).image).toBeNull();
		expect(createReward(db, { title: 'y', cost: 1, image: '' }).image).toBeNull();
		expect(createReward(db, { title: 'f', cost: 1, image: '🇺🇸' }).image).toBe('🇺🇸');
		expect(createReward(db, { title: 'z', cost: 1, image: '👨‍👩‍👧' }).image).toBe('👨‍👩‍👧');
	});

	it.each([
		[{ title: '', cost: 5 }],
		[{ title: '   ', cost: 5 }],
		[{ title: 'a'.repeat(61), cost: 5 }],
		[{ title: 5 as unknown as string, cost: 5 }],
		[{ title: 'ok', cost: 0 }],
		[{ title: 'ok', cost: 10_001 }],
		[{ title: 'ok', cost: 1.5 }],
		[{ title: 'ok', cost: '5' as unknown as number }],
		[{ title: 'ok', cost: 5, image: 'ab' }],
		[{ title: 'ok', cost: 5, image: '🍦🍦' }],
		[{ title: 'ok', cost: 5, image: 7 as unknown as string }]
	])('rejects %j', (input) => {
		expect(code(() => createReward(db, input))).toBe('invalid');
	});
});

describe('update, archive, list', () => {
	it('updates only provided fields and validates', () => {
		const r = createReward(db, { title: 'A', cost: 5, image: '🍦' });
		expect(updateReward(db, r.id, { cost: 7 })).toMatchObject({ title: 'A', cost: 7, image: '🍦' });
		expect(updateReward(db, r.id, { image: null }).image).toBeNull();
		expect(updateReward(db, r.id, { title: 'B' }).title).toBe('B');
		expect(updateReward(db, r.id, {}).title).toBe('B');
		expect(code(() => updateReward(db, r.id, { cost: 0 }))).toBe('invalid');
		expect(code(() => updateReward(db, 'nope', { cost: 3 }))).toBe('not_found');
	});

	it('archives softly, keeps redemption history, and hides from lists', () => {
		const r = createReward(db, { title: 'A', cost: 5 });
		const keep = createReward(db, { title: 'B', cost: 3 });
		db.insert(schema.redemptions).values({ id: 'red', rewardId: r.id, memberId: 'kid' }).run();
		expect(archiveReward(db, r.id).active).toBe(false);
		expect(archiveReward(db, r.id).active).toBe(false);
		expect(db.select().from(schema.redemptions).all()).toHaveLength(1);
		expect(listRewards(db).map((x) => x.id)).toEqual([keep.id]);
		expect(listRewards(db, { includeArchived: true })).toHaveLength(2);
		expect(code(() => archiveReward(db, 'nope'))).toBe('not_found');
	});

	it('lists cheapest first', () => {
		createReward(db, { title: 'Big', cost: 100 });
		createReward(db, { title: 'Small', cost: 20 });
		expect(listRewards(db).map((r) => r.title)).toEqual(['Small', 'Big']);
	});
});

describe('goals', () => {
	it('keeps several goals per member but exactly one current', () => {
		const a = createReward(db, { title: 'A', cost: 20 });
		const b = createReward(db, { title: 'B', cost: 100 });
		setGoal(db, 'kid', a.id);
		setGoal(db, 'kid', b.id);
		setGoal(db, 'sib', a.id);
		const rows = db.select().from(schema.goals).all();
		const mine = rows.filter((g) => g.memberId === 'kid');
		expect(mine).toHaveLength(2);
		expect(mine.filter((g) => g.current)).toHaveLength(1);
		expect(getGoal(db, 'kid')?.reward.id).toBe(b.id);
		expect(getGoal(db, 'sib')?.reward.id).toBe(a.id);
	});

	it('rejects unknown members, unknown or archived rewards, leaving the old goal', () => {
		const a = createReward(db, { title: 'A', cost: 20 });
		const old = createReward(db, { title: 'Old', cost: 20 });
		setGoal(db, 'kid', old.id);
		archiveReward(db, a.id);
		expect(code(() => setGoal(db, 'ghost', old.id))).toBe('not_found');
		expect(code(() => setGoal(db, 'kid', 'nope'))).toBe('not_found');
		expect(code(() => setGoal(db, 'kid', a.id))).toBe('not_found');
		expect(getGoal(db, 'kid')?.reward.id).toBe(old.id);
	});

	it('archiving the goal reward clears the goal', () => {
		const a = createReward(db, { title: 'A', cost: 20 });
		setGoal(db, 'kid', a.id);
		archiveReward(db, a.id);
		expect(getGoal(db, 'kid')).toBeNull();
		expect(db.select().from(schema.goals).all()).toHaveLength(0);
	});

	it('returns null when no goal, and ignores an archived reward row', () => {
		expect(getGoal(db, 'kid')).toBeNull();
		const a = createReward(db, { title: 'A', cost: 20 });
		db.insert(schema.goals).values({ id: 'g', memberId: 'kid', rewardId: a.id }).run();
		db.update(schema.rewards).set({ active: false }).run();
		expect(getGoal(db, 'kid')).toBeNull();
	});

	it('computes progress: zero, partial, exact, and over cost', () => {
		const r = createReward(db, { title: 'A', cost: 20 });
		expect(setGoal(db, 'kid', r.id)).toMatchObject({
			balance: 0,
			cost: 20,
			remaining: 20,
			percent: 0
		});
		awardBonus(db, { memberId: 'kid', delta: 5, note: 'x' });
		expect(getGoal(db, 'kid')).toMatchObject({ balance: 5, remaining: 15, percent: 25 });
		awardBonus(db, { memberId: 'kid', delta: 15, note: 'x' });
		expect(getGoal(db, 'kid')).toMatchObject({ balance: 20, remaining: 0, percent: 100 });
		awardBonus(db, { memberId: 'kid', delta: 10, note: 'x' });
		expect(getGoal(db, 'kid')).toMatchObject({ balance: 30, remaining: 0, percent: 100 });
	});

	it('does not count pending stars until approved', () => {
		const r = createReward(db, { title: 'A', cost: 10 });
		setGoal(db, 'kid', r.id);
		const chore = createChore(db, { title: 'Dishes', stars: 4 });
		const { completion } = completeChore(db, {
			choreId: chore.id,
			memberId: 'kid',
			date: '2026-01-05',
			now: 1
		});
		expect(getGoal(db, 'kid')).toMatchObject({ balance: 0, percent: 0 });
		approveCompletion(db, completion.id);
		expect(getGoal(db, 'kid')).toMatchObject({ balance: 4, percent: 40 });
	});
});

describe('kid-named goals (hub-ar4.3)', () => {
	it('creates an owned goal, makes it current, and keeps it out of the catalog', () => {
		const cat = createReward(db, { title: 'Catalog', cost: 50 });
		setGoal(db, 'kid', cat.id);
		const g = createOwnGoal(db, 'kid', { title: ' Lego ', cost: 30, image: '🧱' });
		expect(g.reward).toMatchObject({ title: 'Lego', ownerId: 'kid', image: '🧱' });
		expect(getGoal(db, 'kid')?.reward.id).toBe(g.reward.id);
		expect(listRewards(db).map((r) => r.id)).toEqual([cat.id]);
		expect(listRewards(db, { forMemberId: 'kid' })).toHaveLength(2);
		expect(listRewards(db, { forMemberId: 'sib' })).toHaveLength(1);
		const all = listGoals(db, 'kid');
		expect(all.map((x) => [x.reward.title, x.current, x.own])).toEqual([
			['Lego', true, true],
			['Catalog', false, false]
		]);
	});

	it('validates input and caps own goals', () => {
		expect(code(() => createOwnGoal(db, 'kid', { title: '', cost: 5 }))).toBe('invalid');
		expect(code(() => createOwnGoal(db, 'kid', { title: 'x', cost: 0 }))).toBe('invalid');
		expect(code(() => createOwnGoal(db, 'ghost', { title: 'x', cost: 5 }))).toBe('not_found');
		for (let i = 0; i < OWN_GOALS_MAX; i++) createOwnGoal(db, 'kid', { title: `g${i}`, cost: 5 });
		expect(code(() => createOwnGoal(db, 'kid', { title: 'more', cost: 5 }))).toBe('conflict');
		expect(createOwnGoal(db, 'sib', { title: 'mine', cost: 5 }).reward.title).toBe('mine');
	});

	it('only the owner can pick or redeem an owned goal', () => {
		const g = createOwnGoal(db, 'kid', { title: 'Secret', cost: 5 }).reward;
		expect(code(() => setGoal(db, 'sib', g.id))).toBe('not_found');
		expect(kidMayPickGoal(db, 'sib', g.id)).toBe(false);
		expect(kidMayPickGoal(db, 'kid', g.id)).toBe(true);
		db.insert(schema.members)
			.values({ id: 'mum', name: 'mum', role: 'adult', color: 'blue' })
			.run();
		awardBonus(db, { memberId: 'sib', delta: 10, note: 'x' });
		expect(
			code(() => redeemReward(db, { memberId: 'sib', rewardId: g.id, approvedBy: 'mum' }))
		).toBe('not_found');
	});

	it('redeems an owned goal through the normal flow', () => {
		const g = createOwnGoal(db, 'kid', { title: 'Lego', cost: 8 }).reward;
		db.insert(schema.members)
			.values({ id: 'mum', name: 'mum', role: 'adult', color: 'blue' })
			.run();
		awardBonus(db, { memberId: 'kid', delta: 10, note: 'x' });
		expect(redeemReward(db, { memberId: 'kid', rewardId: g.id, approvedBy: 'mum' })).toMatchObject({
			cost: 8,
			balance: 2
		});
	});

	it('removing the current goal archives it and promotes the newest remaining', () => {
		const cat = createReward(db, { title: 'Catalog', cost: 50 });
		setGoal(db, 'kid', cat.id);
		const a = createOwnGoal(db, 'kid', { title: 'A', cost: 5 }).reward;
		const b = createOwnGoal(db, 'kid', { title: 'B', cost: 6 }).reward;
		removeGoal(db, 'kid', b.id);
		expect(getGoal(db, 'kid')?.reward.id).toBe(a.id);
		expect(
			db
				.select()
				.from(schema.rewards)
				.all()
				.find((r) => r.id === b.id)?.active
		).toBe(false);
		removeGoal(db, 'kid', cat.id);
		expect(listRewards(db).map((r) => r.id)).toEqual([cat.id]);
		removeGoal(db, 'kid', a.id);
		expect(getGoal(db, 'kid')).toBeNull();
		expect(code(() => removeGoal(db, 'kid', a.id))).toBe('not_found');
	});

	it('removing a non-current goal leaves the current one', () => {
		const a = createOwnGoal(db, 'kid', { title: 'A', cost: 5 }).reward;
		const b = createOwnGoal(db, 'kid', { title: 'B', cost: 6 }).reward;
		removeGoal(db, 'kid', a.id);
		expect(getGoal(db, 'kid')?.reward.id).toBe(b.id);
	});

	it('isKidSelfServe is true only for children', () => {
		db.insert(schema.members)
			.values({ id: 'mum', name: 'mum', role: 'adult', color: 'blue' })
			.run();
		expect(isKidSelfServe(db, 'kid')).toBe(true);
		expect(isKidSelfServe(db, 'mum')).toBe(false);
		expect(isKidSelfServe(db, 'ghost')).toBe(false);
	});
});
