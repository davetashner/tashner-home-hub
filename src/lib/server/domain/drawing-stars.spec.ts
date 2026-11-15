import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb, schema, type Db } from '../db/index.js';
import { setHouseholdTimeZone } from '../household.js';
import { LedgerError } from './ledger.js';
import { starBalance } from './stars.js';
import {
	awardDrawingStar,
	awardGameStar,
	gameStarsEnabled,
	setGameStarsEnabled,
	drawingStarSummary,
	drawingStarsEnabled,
	readDrawingStarsSetting,
	setDrawingStarsEnabled
} from './drawing-stars.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 10, 12);
let db: Db;

beforeEach(() => {
	db = openDb(':memory:');
	db.insert(schema.members)
		.values([
			{ id: 'kid', name: 'Test Kid', role: 'child', color: 'member-1' },
			{ id: 'sib', name: 'Test Sib', role: 'child', color: 'member-2' },
			{ id: 'grown', name: 'Test Adult', role: 'adult', color: 'member-3' }
		])
		.run();
	setHouseholdTimeZone(db, 'UTC');
});

describe('awardDrawingStar', () => {
	it('writes one ledger star, counted in the balance', () => {
		expect(awardDrawingStar(db, 'kid', T0)).toEqual({ awarded: true, streak: 1 });
		expect(starBalance(db, 'kid')).toBe(1);
		const row = db.select().from(schema.starTransactions).get();
		expect(row).toMatchObject({
			reason: 'drawing',
			refId: '2026-11-10',
			delta: 1,
			status: 'approved'
		});
	});
	it('gives only one star per kid per day', () => {
		awardDrawingStar(db, 'kid', T0);
		expect(awardDrawingStar(db, 'kid', T0 + 3_600_000)).toEqual({ awarded: false, streak: 1 });
		expect(starBalance(db, 'kid')).toBe(1);
		expect(awardDrawingStar(db, 'sib', T0).awarded).toBe(true);
	});
	it('counts the day in the household zone, not UTC', () => {
		setHouseholdTimeZone(db, 'America/Los_Angeles');
		const lateEvening = Date.UTC(2026, 10, 11, 3); // Nov 10 evening in LA
		awardDrawingStar(db, 'kid', lateEvening);
		expect(awardDrawingStar(db, 'kid', lateEvening + 3_600_000).awarded).toBe(false);
		expect(db.select().from(schema.starTransactions).get()?.refId).toBe('2026-11-10');
	});
	it('builds a streak over consecutive days and restarts after a gap', () => {
		awardDrawingStar(db, 'kid', T0);
		expect(awardDrawingStar(db, 'kid', T0 + DAY).streak).toBe(2);
		expect(awardDrawingStar(db, 'kid', T0 + 2 * DAY).streak).toBe(3);
		expect(awardDrawingStar(db, 'kid', T0 + 5 * DAY).streak).toBe(1);
	});
	it('does nothing when stars are off', () => {
		setDrawingStarsEnabled(db, false);
		expect(awardDrawingStar(db, 'kid', T0)).toEqual({ awarded: false, streak: 0 });
		expect(drawingStarsEnabled(db)).toBe(false);
		setDrawingStarsEnabled(db, true);
		expect(drawingStarsEnabled(db)).toBe(true);
		expect(starBalance(db, 'kid')).toBe(0);
	});
	it('gives adults no stars', () => {
		expect(awardDrawingStar(db, 'grown', T0).awarded).toBe(false);
		expect(db.select().from(schema.starTransactions).all()).toHaveLength(0);
	});
	it('rejects a missing or unknown member', () => {
		expect(() => awardDrawingStar(db, undefined, T0)).toThrow(LedgerError);
		expect(() => awardDrawingStar(db, '', T0)).toThrow(LedgerError);
		expect(() => awardDrawingStar(db, 'ghost', T0)).toThrow(LedgerError);
	});
	it('ignores rejected rows when counting', () => {
		awardDrawingStar(db, 'kid', T0);
		db.update(schema.starTransactions)
			.set({ status: 'rejected' })
			.where(eq(schema.starTransactions.memberId, 'kid'))
			.run();
		expect(awardDrawingStar(db, 'kid', T0).awarded).toBe(true);
	});
});

describe('drawingStarSummary', () => {
	it('lists children with streak and earned-today', () => {
		awardDrawingStar(db, 'kid', T0);
		const s = drawingStarSummary(db, T0 + DAY);
		expect(s.date).toBe('2026-11-11');
		expect(s.enabled).toBe(true);
		expect(s.streaks).toEqual({
			kid: { streak: 1, earned: false },
			sib: { streak: 0, earned: false }
		});
		expect(drawingStarSummary(db, T0).streaks.kid).toEqual({ streak: 1, earned: true });
	});
	it('reports the setting', () => {
		setDrawingStarsEnabled(db, false);
		expect(readDrawingStarsSetting(db)).toBe(false);
		expect(drawingStarSummary(db, T0).enabled).toBe(false);
	});
	it('treats a malformed stored setting as on', () => {
		db.insert(schema.settings).values({ key: 'drawing.stars', value: '{bad' }).run();
		expect(readDrawingStarsSetting(db)).toBe(true);
	});
});

describe('awardGameStar (hub-t27j.25)', () => {
	it('pays a kid once per round and again for the next round', () => {
		expect(awardGameStar(db, 'kid', 'game:s:1', T0)).toBe(true);
		expect(awardGameStar(db, 'kid', 'game:s:1', T0)).toBe(false);
		expect(awardGameStar(db, 'kid', 'game:s:2', T0)).toBe(true);
		expect(starBalance(db, 'kid')).toBe(2);
	});
	it('never pays adults or unknown members', () => {
		expect(awardGameStar(db, 'grown', 'game:s:1', T0)).toBe(false);
		expect(awardGameStar(db, 'nobody', 'game:s:1', T0)).toBe(false);
		expect(starBalance(db, 'grown')).toBe(0);
	});
	it('pays nothing while the setting is off, and does not touch the daily star', () => {
		expect(gameStarsEnabled(db)).toBe(true);
		setGameStarsEnabled(db, false);
		expect(gameStarsEnabled(db)).toBe(false);
		expect(awardGameStar(db, 'kid', 'game:s:1', T0)).toBe(false);
		setGameStarsEnabled(db, true);
		expect(awardGameStar(db, 'kid', 'game:s:1', T0)).toBe(true);
		expect(awardDrawingStar(db, 'kid', T0)).toEqual({ awarded: true, streak: 1 });
	});
});
