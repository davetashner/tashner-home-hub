/** Practice activity storage and validation (hub-kko.1). Star math lives in `#lib/domain/practice.js`. */
import { asc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { cleanEmoji } from '#lib/domain/emoji.js';
import type { Db } from '../db/index.js';
import { members, practiceActivities } from '../db/schema.js';
import { LedgerError } from './ledger.js';

export const ACTIVITY_NAME_MAX = 40;

export interface PracticeActivity {
	id: string;
	name: string;
	emoji: string | null;
	minutesPerBlock: number;
	starsPerBlock: number;
	dailyStarCap: number;
	/** null = every kid; otherwise just these members. */
	memberIds: string[] | null;
	active: boolean;
	sortOrder: number;
}

export interface PracticeActivityInput {
	name: string;
	emoji?: string | null;
	minutesPerBlock: number;
	starsPerBlock: number;
	dailyStarCap: number;
	memberIds?: string[] | null;
	active?: boolean;
	sortOrder?: number;
}

const invalid = (msg: string) => new LedgerError('invalid', msg);

function int(v: unknown, label: string, min: number, max: number): number {
	if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max)
		throw invalid(`${label} must be a whole number from ${min} to ${max}`);
	return v;
}

function validName(v: unknown): string {
	const t = typeof v === 'string' ? v.trim() : '';
	if (t.length < 1 || t.length > ACTIVITY_NAME_MAX)
		throw invalid(`name must be 1-${ACTIVITY_NAME_MAX} characters`);
	return t;
}

function validEmoji(v: unknown): string | null {
	if (v === null || v === undefined || v === '') return null;
	const clean = typeof v === 'string' ? cleanEmoji(v) : null;
	if (!clean) throw invalid('emoji must be a single emoji');
	return clean;
}

function validMembers(db: Db, v: unknown): string | null {
	if (v === null || v === undefined) return null;
	if (!Array.isArray(v) || v.length === 0 || v.some((m) => typeof m !== 'string'))
		throw invalid('memberIds must be null (all kids) or a non-empty list of member ids');
	const ids = [...new Set(v as string[])];
	const kids = new Set(
		db
			.select({ id: members.id, role: members.role })
			.from(members)
			.all()
			.filter((m) => m.role === 'child')
			.map((m) => m.id)
	);
	if (ids.some((m) => !kids.has(m))) throw invalid('memberIds must all be kids');
	return JSON.stringify(ids);
}

function toActivity(r: typeof practiceActivities.$inferSelect): PracticeActivity {
	let memberIds: string[] | null = null;
	if (r.memberIds) {
		try {
			const parsed: unknown = JSON.parse(r.memberIds);
			if (Array.isArray(parsed)) memberIds = parsed.filter((m) => typeof m === 'string');
		} catch {
			memberIds = [];
		}
	}
	return {
		id: r.id,
		name: r.name,
		emoji: r.emoji,
		minutesPerBlock: r.minutesPerBlock,
		starsPerBlock: r.starsPerBlock,
		dailyStarCap: r.dailyStarCap,
		memberIds,
		active: r.active,
		sortOrder: r.sortOrder
	};
}

function validBool(v: unknown): boolean {
	if (typeof v !== 'boolean') throw invalid('active must be true or false');
	return v;
}

export function createPracticeActivity(db: Db, input: PracticeActivityInput): PracticeActivity {
	const all = db.select().from(practiceActivities).all();
	return toActivity(
		db
			.insert(practiceActivities)
			.values({
				id: randomUUID(),
				name: validName(input.name),
				emoji: validEmoji(input.emoji),
				minutesPerBlock: int(input.minutesPerBlock, 'minutesPerBlock', 1, 240),
				starsPerBlock: int(input.starsPerBlock, 'starsPerBlock', 1, 20),
				dailyStarCap: int(input.dailyStarCap, 'dailyStarCap', 1, 100),
				memberIds: validMembers(db, input.memberIds),
				active: input.active === undefined ? true : validBool(input.active),
				sortOrder:
					input.sortOrder === undefined
						? Math.max(-1, ...all.map((a) => a.sortOrder)) + 1
						: int(input.sortOrder, 'sortOrder', 0, 10000)
			})
			.returning()
			.get()
	);
}

/** Updates only the fields present in `patch`. */
export function updatePracticeActivity(
	db: Db,
	id: string,
	patch: Partial<PracticeActivityInput>
): PracticeActivity {
	const set: Partial<typeof practiceActivities.$inferInsert> = {};
	if (patch.name !== undefined) set.name = validName(patch.name);
	if (patch.emoji !== undefined) set.emoji = validEmoji(patch.emoji);
	if (patch.minutesPerBlock !== undefined)
		set.minutesPerBlock = int(patch.minutesPerBlock, 'minutesPerBlock', 1, 240);
	if (patch.starsPerBlock !== undefined)
		set.starsPerBlock = int(patch.starsPerBlock, 'starsPerBlock', 1, 20);
	if (patch.dailyStarCap !== undefined)
		set.dailyStarCap = int(patch.dailyStarCap, 'dailyStarCap', 1, 100);
	if (patch.memberIds !== undefined) set.memberIds = validMembers(db, patch.memberIds);
	if (patch.active !== undefined) set.active = validBool(patch.active);
	if (patch.sortOrder !== undefined) set.sortOrder = int(patch.sortOrder, 'sortOrder', 0, 10000);
	return db.transaction((tx) => {
		const existing = tx
			.select()
			.from(practiceActivities)
			.where(eq(practiceActivities.id, id))
			.get();
		if (!existing) throw new LedgerError('not_found', 'Activity not found');
		if (Object.keys(set).length === 0) return toActivity(existing);
		return toActivity(
			tx.update(practiceActivities).set(set).where(eq(practiceActivities.id, id)).returning().get()
		);
	});
}

/** Every activity, active or not, in the order grown-ups arranged them. */
export function listPracticeActivities(db: Db): PracticeActivity[] {
	return db
		.select()
		.from(practiceActivities)
		.orderBy(asc(practiceActivities.sortOrder), asc(practiceActivities.name))
		.all()
		.map(toActivity);
}

/** Active activities that apply to `memberId` (the kid screen's list). */
export function activitiesForMember(db: Db, memberId: string): PracticeActivity[] {
	const member = db.select().from(members).where(eq(members.id, memberId)).get();
	if (!member || member.role !== 'child') return [];
	return listPracticeActivities(db).filter(
		(a) => a.active && (a.memberIds === null || a.memberIds.includes(memberId))
	);
}
