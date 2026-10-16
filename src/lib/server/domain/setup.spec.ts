import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb, schema, type Db } from '../db/index.js';
import { createMember } from './members.js';
import { verifyPin } from './pin.js';
import { completeSetup, needsSetup, SetupError } from './setup.js';

let db: Db;
beforeEach(() => {
	db = openDb(':memory:');
});

const input = { name: ' Sam ', color: 'member-2', avatar: '🦊', pin: '4817' };

function code(fn: () => unknown): string | undefined {
	try {
		fn();
	} catch (e) {
		return e instanceof SetupError ? e.code : 'other';
	}
	return undefined;
}

describe('needsSetup', () => {
	it('is true on an empty database', () => {
		expect(needsSetup(db)).toBe(true);
	});

	it('stays true while only children or PIN-less adults exist', () => {
		createMember(db, { name: 'Kid', role: 'child', color: 'member-1' });
		createMember(db, { name: 'NoPin', role: 'adult', color: 'member-1' });
		expect(needsSetup(db)).toBe(true);
	});

	it('is false once an adult has a PIN', () => {
		completeSetup(db, input);
		expect(needsSetup(db)).toBe(false);
	});
});

describe('completeSetup', () => {
	it('creates the first adult with a verifiable PIN', () => {
		const m = completeSetup(db, input);
		expect(m).toMatchObject({ name: 'Sam', role: 'adult', avatar: '🦊', hasPin: true });
		const row = db.select().from(schema.members).where(eq(schema.members.id, m.id)).get()!;
		expect(verifyPin('4817', row.pinHash)).toBe(true);
	});

	it('refuses a second setup', () => {
		completeSetup(db, input);
		expect(code(() => completeSetup(db, { ...input, name: 'Other' }))).toBe('already_setup');
		expect(db.select().from(schema.members).all()).toHaveLength(1);
	});

	it('rejects weak PINs without creating anyone', () => {
		for (const pin of ['1234', '1111', '12', 'abcd']) {
			expect(code(() => completeSetup(db, { ...input, pin }))).toBe('validation');
		}
		expect(db.select().from(schema.members).all()).toHaveLength(0);
	});

	it('rolls back the adult when member validation fails', () => {
		expect(() => completeSetup(db, { ...input, name: '' })).toThrow();
		expect(db.select().from(schema.members).all()).toHaveLength(0);
		expect(needsSetup(db)).toBe(true);
	});

	it('lets only one of two racing setups win', () => {
		const results = [
			code(() => completeSetup(db, { ...input, name: 'A' })),
			code(() => completeSetup(db, { ...input, name: 'B' }))
		];
		expect(results.sort()).toEqual(['already_setup', undefined]);
		expect(db.select().from(schema.members).all()).toHaveLength(1);
	});

	it('serializes across connections to the same file', async () => {
		const { mkdtempSync } = await import('node:fs');
		const { tmpdir } = await import('node:os');
		const { join } = await import('node:path');
		const file = join(mkdtempSync(join(tmpdir(), 'hub-setup-')), 'hub.db');
		const a = openDb(file);
		const b = openDb(file);
		completeSetup(a, { ...input, name: 'A' });
		expect(code(() => completeSetup(b, { ...input, name: 'B' }))).toBe('already_setup');
		expect(b.select().from(schema.members).all()).toHaveLength(1);
	});
});
