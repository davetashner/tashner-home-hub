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
	listCheckins,
	listSessions,
	readCard,
	saveCard,
	sessionLog,
	submitCheckin,
	sitterApprover,
	readTonightInfo,
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
		tonight: 'Pizza',
		pets: [{ name: 'Rex', kind: 'Dog', notes: 'Pill in cheese at 8', feedTimes: ['18:00'] }],
		vet: { name: 'Test Vet', phone: '555-0102', hours: '9-5', address: '2 Test Road' },
		petER: { name: 'Test Pet ER', phone: '555-0103', hours: '24h', address: '3 Test Road' }
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
		expect(stored).not.toMatch(
			/555-0101|555-0102|555-0103|Test Lane|Test Road|Peanuts|Inhaler|hunter2|Pill in cheese|Test Vet/
		);
		expect(stored).toMatch(/TestNet/);
		// Names and feeding times are not sealed: the wall's plan needs them before the PIN.
		expect(stored).toMatch(/Rex/);
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

describe('check-ins', () => {
	it('are stored on the active session, once a minute per kind', () => {
		const s = createSession(db, { endAt: NOW + 2 * H, sitterName: 'Sam' }, NOW);
		expect(submitCheckin(db, 'in-bed', NOW)).toMatchObject({
			ok: true,
			at: NOW,
			sitterName: 'Sam'
		});
		expect(submitCheckin(db, 'in-bed', NOW + 30_000)).toMatchObject({ ok: false, status: 429 });
		expect(submitCheckin(db, 'call-me', NOW + 30_000)).toMatchObject({ ok: true });
		expect(submitCheckin(db, 'in-bed', NOW + 61_000)).toMatchObject({ ok: true });
		expect(listCheckins(db, s.id).map((c) => c.kind)).toEqual(['in-bed', 'call-me', 'in-bed']);
	});
	it('are refused without an active session or with a bad kind', () => {
		expect(submitCheckin(db, 'all-good', NOW)).toMatchObject({ ok: false, status: 409 });
		const s = createSession(db, { startAt: NOW + H, endAt: NOW + 2 * H }, NOW);
		expect(submitCheckin(db, 'all-good', NOW)).toMatchObject({ status: 409 });
		expect(submitCheckin(db, 'bogus', NOW + H + 1)).toMatchObject({ status: 400 });
		endSession(db, s.id, NOW + H + 1);
		expect(submitCheckin(db, 'all-good', NOW + H + 2)).toMatchObject({ status: 409 });
		expect(listCheckins(db, s.id)).toEqual([]);
	});
});

describe('session log', () => {
	it('lists finished sessions with check-ins, newest first, capped at ten', () => {
		const first = createSession(db, { endAt: NOW + H, sitterName: 'Sam' }, NOW);
		submitCheckin(db, 'all-good', NOW + 1000);
		endSession(db, first.id, NOW + 2000);
		createSession(db, { startAt: NOW + 3 * H, endAt: NOW + 4 * H }, NOW);
		const log = sessionLog(db, NOW + 10 * H);
		expect(log.map((e) => e.id)).toEqual([expect.any(String), first.id]);
		expect(log[1]!.checkins).toEqual([{ kind: 'all-good', at: NOW + 1000 }]);
		expect(log[1]!.sitterName).toBe('Sam');
	});
	it('leaves out running and scheduled sessions', () => {
		createSession(db, { endAt: NOW + H }, NOW);
		createSession(db, { startAt: NOW + 2 * H, endAt: NOW + 3 * H }, NOW);
		expect(sessionLog(db, NOW + 1000)).toEqual([]);
	});
	it('keeps only the last ten', () => {
		for (let i = 0; i < 12; i++) {
			const t = NOW + i * 2 * H;
			endSession(db, createSession(db, { startAt: t, endAt: t + H }, t - 1).id, t + 1);
		}
		const log = sessionLog(db, NOW + 30 * H);
		expect(log).toHaveLength(10);
		expect(log[0]!.startAt).toBe(NOW + 11 * 2 * H);
	});
});

describe('sitterApprover', () => {
	it('lets the PIN approve only when the parents allowed it', () => {
		createSession(db, { endAt: NOW + H, pin: '4812' }, NOW);
		expect(() => sitterApprover(db, '4812', NOW)).toThrow(/did not allow/);
		endSession(db, currentSession(db, NOW)!.id, NOW);
		createSession(db, { endAt: NOW + H, pin: '4812', approveJobs: true }, NOW + 1);
		expect(sitterApprover(db, '4812', NOW + 2).approveJobs).toBe(true);
	});
	it('refuses a wrong PIN, a missing PIN and an ended session', () => {
		createSession(db, { endAt: NOW + H, pin: '4812', approveJobs: true }, NOW);
		expect(() => sitterApprover(db, '0000', NOW)).toThrow(/Wrong PIN/);
		expect(() => sitterApprover(db, undefined, NOW)).toThrow(/Wrong PIN/);
		expect(() => sitterApprover(db, '4812', NOW + 2 * H)).toThrow(/Wrong PIN/);
	});
});

describe('tonight info', () => {
	it('shows rules and bedtimes without the sensitive parts', () => {
		expect(readTonightInfo(db)).toEqual({ rules: [], bedtimes: [], pets: [] });
		saveCard(db, ring, {
			contacts: [{ name: 'Grandma', relation: 'Grandmother', phone: '555-0101' }],
			address: '1 Test Lane',
			kids: [{ memberId: 'a', bedtime: '19:30', allergies: 'Peanuts', medical: 'Inhaler' }],
			rules: ['No screens'],
			pets: [{ name: 'Rex', notes: 'Pill in cheese', feedTimes: ['18:00', 'bad'] }],
			vet: { name: 'Test Vet', phone: '555-0102' }
		});
		const info = readTonightInfo(db);
		expect(info).toEqual({
			rules: ['No screens'],
			bedtimes: [{ memberId: 'a', bedtime: '19:30' }],
			pets: [{ name: 'Rex', feedTimes: ['18:00'] }]
		});
		expect(JSON.stringify(info)).not.toMatch(/Test Lane|Peanuts|555-01|Pill|Test Vet/);
	});
	it('survives a damaged card row', () => {
		db.insert(settings).values({ key: SITTER_CARD_KEY, value: 'not json' }).run();
		expect(readTonightInfo(db)).toEqual({ rules: [], bedtimes: [], pets: [] });
	});
});
