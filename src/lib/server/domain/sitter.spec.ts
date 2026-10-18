import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { emptyCard } from '#lib/domain/sitter.js';
import { openDb, type Db } from '../db/index.js';
import { settings } from '../db/schema.js';
import { createKeyring } from './secrets.js';
import { readCard, saveCard, SITTER_CARD_KEY } from './sitter.js';

let db: Db;
const ring = createKeyring('k1', { k1: randomBytes(32) });

beforeEach(() => {
	db = openDb(':memory:');
});

describe('card storage', () => {
	const card = {
		contacts: [{ name: 'Grandma', relation: 'Grandmother', phone: '555-0101' }],
		address: '1 Test Lane',
		kids: [{ memberId: 'a', bedtime: '19:30', allergies: 'Peanuts', medical: 'Inhaler' }],
		rules: ['No screens'],
		wifiName: 'TestNet',
		wifiPassword: 'hunter2',
		tonight: 'Pizza'
	};
	it('is empty before it is saved', () => {
		expect(readCard(db, ring).contacts).toEqual([]);
	});
	it('round trips, and the sensitive fields are not plaintext at rest', () => {
		saveCard(db, ring, card);
		expect(readCard(db, ring)).toEqual(card);
		const stored = db
			.select()
			.from(settings)
			.all()
			.find((r) => r.key === SITTER_CARD_KEY)!.value;
		expect(stored).not.toMatch(/555-0101|Test Lane|Peanuts|Inhaler|hunter2/);
		expect(stored).toMatch(/TestNet/);
		saveCard(db, ring, { ...card, tonight: 'Soup' });
		expect(readCard(db, ring).tonight).toBe('Soup');
	});
	it('cannot be read with another key', () => {
		saveCard(db, ring, card);
		const other = createKeyring('k1', { k1: randomBytes(32) });
		expect(readCard(db, other)).toEqual(emptyCard());
	});
});
