import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { emptyCard } from '#lib/domain/sitter.js';
import { openDb, type Db } from '../db/index.js';
import { settings } from '../db/schema.js';
import { LedgerError } from './ledger.js';
import { createKeyring } from './secrets.js';
import {
	checkSitterPin,
	createSession,
	currentSession,
	endSession,
	extendSession,
	listSessions,
	readCard,
	saveCard,
	SITTER_CARD_KEY
} from './sitter.js';

const H = 3_600_000;
const NOW = 1_000_000_000_000;
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

describe('sessions', () => {
	it('creates with defaults and never exposes the PIN hash', () => {
		const s = createSession(db, { endAt: NOW + 3 * H, sitterName: ' Sam ', pin: '4812' }, NOW);
		expect(s).toMatchObject({
			sitterName: 'Sam',
			status: 'active',
			hasPin: true,
			approveJobs: false,
			funAllowed: true
		});
		expect(JSON.stringify(s)).not.toMatch(/scrypt/);
		expect(JSON.stringify(listSessions(db, NOW))).not.toMatch(/scrypt/);
	});
	it('stores permissions and a scheduled window', () => {
		const s = createSession(
			db,
			{ startAt: NOW + H, endAt: NOW + 3 * H, approveJobs: true, funAllowed: false },
			NOW
		);
		expect(s).toMatchObject({ status: 'scheduled', hasPin: false, approveJobs: true });
		expect(s.funAllowed).toBe(false);
		expect(s.sitterName).toBeNull();
	});
	it('rejects bad input and overlaps', () => {
		const code = (fn: () => unknown) => {
			try {
				fn();
			} catch (e) {
				return (e as LedgerError).code;
			}
		};
		expect(code(() => createSession(db, { endAt: NOW - 1 }, NOW))).toBe('invalid');
		expect(code(() => createSession(db, { endAt: NOW + H, pin: '12' }, NOW))).toBe('invalid');
		createSession(db, { endAt: NOW + H }, NOW);
		expect(code(() => createSession(db, { endAt: NOW + 2 * H }, NOW))).toBe('conflict');
	});
	it('auto-ends at the end time and ends early on request', () => {
		const s = createSession(db, { endAt: NOW + H }, NOW);
		expect(currentSession(db, NOW + H - 1)?.id).toBe(s.id);
		expect(currentSession(db, NOW + H)).toBeNull();
		const early = endSession(db, s.id, NOW + 10);
		expect(early.status).toBe('ended');
		expect(endSession(db, s.id, NOW + 20).endedAt).toBe(NOW + 10);
		expect(currentSession(db, NOW + 11)).toBeNull();
		createSession(db, { endAt: NOW + 2 * H }, NOW + 20);
	});
	it('prefers the active session over a scheduled one', () => {
		const later = createSession(db, { startAt: NOW + 5 * H, endAt: NOW + 6 * H }, NOW);
		expect(currentSession(db, NOW)?.id).toBe(later.id);
		const now = createSession(db, { endAt: NOW + H }, NOW);
		expect(currentSession(db, NOW)?.id).toBe(now.id);
	});
	it('extends, and refuses to extend an ended or unknown session', () => {
		const s = createSession(db, { endAt: NOW + H }, NOW);
		expect(extendSession(db, s.id, NOW + 2 * H, NOW).endAt).toBe(NOW + 2 * H);
		expect(() => extendSession(db, s.id, NOW + H, NOW)).toThrow(/later/);
		expect(() => extendSession(db, s.id, NOW + 4 * H, NOW + 3 * H)).toThrow(/ended/);
		expect(() => extendSession(db, 'nope', NOW + 4 * H, NOW)).toThrow(/No such/);
		expect(() => endSession(db, 'nope', NOW)).toThrow(/No such/);
	});
});

describe('checkSitterPin', () => {
	it('accepts the PIN only during the active window', () => {
		createSession(db, { startAt: NOW + H, endAt: NOW + 3 * H, pin: '4812' }, NOW);
		expect(checkSitterPin(db, '4812', NOW)).toBeNull();
		expect(checkSitterPin(db, '4812', NOW + H)?.status).toBe('active');
		expect(checkSitterPin(db, '0000', NOW + H)).toBeNull();
		expect(checkSitterPin(db, 4812, NOW + H)).toBeNull();
		expect(checkSitterPin(db, '4812', NOW + 3 * H)).toBeNull();
	});
	it('never matches a session without a PIN', () => {
		createSession(db, { endAt: NOW + H }, NOW);
		expect(checkSitterPin(db, '', NOW)).toBeNull();
		expect(checkSitterPin(db, '0000', NOW)).toBeNull();
	});
});
