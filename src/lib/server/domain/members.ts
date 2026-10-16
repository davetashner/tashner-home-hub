import { eq, sql } from 'drizzle-orm';
import { isMemberColor, type MemberColor } from '../../domain/member-colors.js';
import type { Db } from '../db/index.js';
import { members, ROLES } from '../db/schema.js';

export type Role = (typeof ROLES)[number];

/** Public member shape. `pinHash` is never exposed; use `hasPin`. */
export interface Member {
	id: string;
	name: string;
	role: Role;
	color: MemberColor;
	avatar: string | null;
	hasPin: boolean;
	createdAt: number;
}

export interface MemberInput {
	name: string;
	role: Role;
	color: string;
	avatar?: string | null;
}

export type MemberPatch = Partial<MemberInput>;

export type MemberErrorCode = 'validation' | 'not_found' | 'last_adult' | 'confirm_required';

export class MemberError extends Error {
	constructor(
		readonly code: MemberErrorCode,
		message: string
	) {
		super(message);
		this.name = 'MemberError';
	}
}

const NAME_MAX = 40;
const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

function validName(value: unknown): string {
	const name = typeof value === 'string' ? value.trim() : '';
	if (name.length < 1 || name.length > NAME_MAX) {
		throw new MemberError('validation', `Name must be 1-${NAME_MAX} characters.`);
	}
	return name;
}

function validRole(value: unknown): Role {
	if (!(ROLES as readonly unknown[]).includes(value)) {
		throw new MemberError('validation', 'Role must be adult or child.');
	}
	return value as Role;
}

function validColor(value: unknown): MemberColor {
	if (!isMemberColor(value)) {
		throw new MemberError('validation', 'Color must be one of the member color tokens.');
	}
	return value;
}

/** An avatar is one emoji grapheme, or null/empty for "use the initial". */
function validAvatar(value: unknown): string | null {
	if (value === null || value === undefined || value === '') return null;
	if (typeof value !== 'string') throw new MemberError('validation', 'Avatar must be an emoji.');
	const graphemes = [...segmenter.segment(value.trim())];
	if (graphemes.length !== 1 || !/\p{Extended_Pictographic}/u.test(value)) {
		throw new MemberError('validation', 'Avatar must be a single emoji.');
	}
	return graphemes[0].segment;
}

type Row = typeof members.$inferSelect;

function toMember(row: Row): Member {
	return {
		id: row.id,
		name: row.name,
		role: row.role,
		color: row.color as MemberColor,
		avatar: row.avatar,
		hasPin: row.pinHash !== null,
		createdAt: row.createdAt
	};
}

export function listMembers(db: Db): Member[] {
	return db.select().from(members).orderBy(members.createdAt, members.name).all().map(toMember);
}

export function getMember(db: Db, id: string): Member | null {
	const row = db.select().from(members).where(eq(members.id, id)).get();
	return row ? toMember(row) : null;
}

function mustGet(db: Db, id: string): Member {
	const member = getMember(db, id);
	if (!member) throw new MemberError('not_found', 'Member not found.');
	return member;
}

function adultCount(db: Db): number {
	const row = db
		.select({ n: sql<number>`count(*)` })
		.from(members)
		.where(eq(members.role, 'adult'))
		.get() as { n: number };
	return row.n;
}

export function createMember(db: Db, input: MemberInput): Member {
	const values = {
		id: crypto.randomUUID(),
		name: validName(input.name),
		role: validRole(input.role),
		color: validColor(input.color),
		avatar: validAvatar(input.avatar)
	};
	db.insert(members).values(values).run();
	return mustGet(db, values.id);
}

export function updateMember(db: Db, id: string, patch: MemberPatch): Member {
	const current = mustGet(db, id);
	const next: Partial<typeof members.$inferInsert> = {};
	if (patch.name !== undefined) next.name = validName(patch.name);
	if (patch.role !== undefined) next.role = validRole(patch.role);
	if (patch.color !== undefined) next.color = validColor(patch.color);
	if (patch.avatar !== undefined) next.avatar = validAvatar(patch.avatar);
	if (next.role === 'child' && current.role === 'adult' && adultCount(db) <= 1) {
		throw new MemberError('last_adult', 'The household needs at least one adult.');
	}
	if (Object.keys(next).length > 0) {
		db.update(members).set(next).where(eq(members.id, id)).run();
	}
	return mustGet(db, id);
}

/**
 * Deleting a member cascades to their completions, stars, goals and redemptions,
 * so callers must pass `confirm: true`.
 */
export function deleteMember(db: Db, id: string, opts: { confirm: boolean }): void {
	const member = mustGet(db, id);
	if (opts.confirm !== true) {
		throw new MemberError(
			'confirm_required',
			'Deleting a member also deletes their stars and history; confirm to proceed.'
		);
	}
	if (member.role === 'adult' && adultCount(db) <= 1) {
		throw new MemberError('last_adult', 'The last adult cannot be deleted.');
	}
	db.delete(members).where(eq(members.id, id)).run();
}
