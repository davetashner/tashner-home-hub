import type { Db } from '../db/index.js';
import { createMember, type Member } from '../domain/members.js';

/** Dev/test only: synthetic household. Never auto-run; real data comes from the setup flow. */
export function seedMembers(db: Db): Member[] {
	return [
		createMember(db, { name: 'Parent One', role: 'adult', color: 'member-1', avatar: '🦊' }),
		createMember(db, { name: 'Parent Two', role: 'adult', color: 'member-3', avatar: null }),
		createMember(db, { name: 'Kid', role: 'child', color: 'member-5', avatar: '🐢' })
	];
}
