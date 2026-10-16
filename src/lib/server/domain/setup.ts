/**
 * First-run bootstrap (FAM-1): a fresh install has no members, and creating members needs an
 * adult session, so the very first adult is created here without one.
 */
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { members } from '../db/schema.js';
import { createMember, MemberError, type Member } from './members.js';
import { hashPin, validatePin } from './pin.js';

/** Setup is needed until some adult holds a PIN: without one nobody can ever unlock settings. */
export function needsSetup(db: Db): boolean {
	const row = db
		.select({ n: sql<number>`count(*)` })
		.from(members)
		.where(and(eq(members.role, 'adult'), isNotNull(members.pinHash)))
		.get() as { n: number };
	return row.n === 0;
}

export type SetupErrorCode = 'already_setup' | 'validation';

export class SetupError extends Error {
	constructor(
		readonly code: SetupErrorCode,
		message: string
	) {
		super(message);
		this.name = 'SetupError';
	}
}

export interface SetupInput {
	name: string;
	color: string;
	avatar?: string | null;
	pin: string;
}

/**
 * Creates the first adult and sets their PIN in one write transaction. The "still needs setup"
 * check happens inside the transaction (BEGIN IMMEDIATE takes the write lock first), so two
 * simultaneous setups can never both succeed. Invalid input rolls the whole thing back.
 */
export function completeSetup(db: Db, input: SetupInput): Member {
	const pin = validatePin(input.pin);
	if (!pin.ok) throw new SetupError('validation', pin.message);
	const pinHash = hashPin(input.pin);
	return db.transaction(
		(tx) => {
			if (!needsSetup(tx as unknown as Db)) {
				throw new SetupError('already_setup', 'This hub is already set up.');
			}
			const member = createMember(tx as unknown as Db, {
				name: input.name,
				role: 'adult',
				color: input.color,
				avatar: input.avatar
			});
			tx.update(members).set({ pinHash }).where(eq(members.id, member.id)).run();
			return { ...member, hasPin: true };
		},
		{ behavior: 'immediate' }
	);
}

export { MemberError };
