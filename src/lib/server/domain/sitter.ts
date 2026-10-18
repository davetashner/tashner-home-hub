/** Sitter mode storage (hub-7pj): the encrypted info card and sitter sessions. */
import { asc, desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
	decideCheckin,
	emptyCard,
	extendedEnd,
	LOG_SESSIONS,
	joinCard,
	normalizeCard,
	overlapsOpenSession,
	pinUsable,
	sessionStatus,
	splitCard,
	validateSitterPin,
	validateWindow,
	type Checkin,
	type CheckinKind,
	type PlainCard,
	type SensitiveCard,
	type SessionStatus,
	type SitterCard
} from '#lib/domain/sitter.js';
import type { Db } from '../db/index.js';
import { settings, sitterCheckins, sitterSessions } from '../db/schema.js';
import { LedgerError } from './ledger.js';
import { hashPin, verifyPin } from './pin.js';
import { decryptSecret, encryptSecret, type Keyring } from './secrets.js';

export const SITTER_CARD_KEY = 'sitter.card';
const AAD = 'sitter.card';

interface Stored {
	plain: PlainCard;
	/** Encrypted JSON of the SensitiveCard. */
	sensitive: string;
}

export function readCard(db: Db, keyring: Keyring): SitterCard {
	const row = db.select().from(settings).where(eq(settings.key, SITTER_CARD_KEY)).get();
	if (!row) return emptyCard();
	try {
		const stored = JSON.parse(row.value) as Stored;
		const sensitive = JSON.parse(decryptSecret(keyring, stored.sensitive, AAD)) as SensitiveCard;
		return joinCard(stored.plain, sensitive);
	} catch {
		// Sealed with a key this server no longer has (e.g. a restore): start a fresh card.
		return emptyCard();
	}
}

export function saveCard(db: Db, keyring: Keyring, raw: unknown): SitterCard {
	const card = normalizeCard(raw);
	const { plain, sensitive } = splitCard(card);
	const stored: Stored = {
		plain,
		sensitive: encryptSecret(keyring, JSON.stringify(sensitive), AAD)
	};
	const value = JSON.stringify(stored);
	db.insert(settings)
		.values({ key: SITTER_CARD_KEY, value })
		.onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: Date.now() } })
		.run();
	return card;
}

type Row = typeof sitterSessions.$inferSelect;

/** A session as the API shows it: never the PIN hash. */
export interface SitterSessionView {
	id: string;
	sitterName: string | null;
	startAt: number;
	endAt: number;
	endedAt: number | null;
	status: SessionStatus;
	hasPin: boolean;
	approveJobs: boolean;
	funAllowed: boolean;
}

export function toView(row: Row, now: number): SitterSessionView {
	return {
		id: row.id,
		sitterName: row.sitterName,
		startAt: row.startAt,
		endAt: row.endAt,
		endedAt: row.endedAt,
		status: sessionStatus(row, now),
		hasPin: row.pinHash !== null,
		approveJobs: row.approveJobs,
		funAllowed: row.funAllowed
	};
}

export interface NewSession {
	startAt?: unknown;
	endAt?: unknown;
	sitterName?: unknown;
	pin?: unknown;
	approveJobs?: unknown;
	funAllowed?: unknown;
}

const invalid = (msg: string) => new LedgerError('invalid', msg);

export function createSession(db: Db, input: NewSession, now: number): SitterSessionView {
	const window = validateWindow(input, now);
	if (!window.ok) throw invalid(window.message);
	let pinHash: string | null = null;
	if (input.pin !== undefined && input.pin !== null && input.pin !== '') {
		const pin = validateSitterPin(input.pin);
		if (!pin.ok) throw invalid(pin.message);
		pinHash = hashPin(pin.value);
	}
	const name = typeof input.sitterName === 'string' ? input.sitterName.trim().slice(0, 60) : '';
	const existing = db.select().from(sitterSessions).all();
	if (overlapsOpenSession(existing, window.value, now))
		throw new LedgerError('conflict', 'Another sitter session overlaps that time. End it first.');
	const row: Row = {
		id: randomUUID(),
		sitterName: name || null,
		pinHash,
		...window.value,
		endedAt: null,
		startNotifiedAt: null,
		endNotifiedAt: null,
		approveJobs: input.approveJobs === true,
		funAllowed: input.funAllowed !== false,
		createdAt: now
	};
	db.insert(sitterSessions).values(row).run();
	return toView(row, now);
}

function load(db: Db, id: string): Row {
	const row = db.select().from(sitterSessions).where(eq(sitterSessions.id, id)).get();
	if (!row) throw new LedgerError('not_found', 'No such sitter session.');
	return row;
}

/** Parents end a session early (or cancel a scheduled one). Ending twice is a no-op. */
export function endSession(db: Db, id: string, now: number): SitterSessionView {
	const row = load(db, id);
	if (sessionStatus(row, now) === 'ended') return toView(row, now);
	// A parent ending it knows already: nothing to announce.
	db.update(sitterSessions)
		.set({ endedAt: now, endNotifiedAt: now, startNotifiedAt: row.startNotifiedAt ?? now })
		.where(eq(sitterSessions.id, id))
		.run();
	return toView({ ...row, endedAt: now }, now);
}

export function extendSession(db: Db, id: string, newEndAt: unknown, now: number) {
	const row = load(db, id);
	const end = extendedEnd(row, newEndAt, now);
	if (!end.ok) throw invalid(end.message);
	db.update(sitterSessions).set({ endAt: end.value }).where(eq(sitterSessions.id, id)).run();
	return toView({ ...row, endAt: end.value }, now);
}

/** Newest first. */
export function listSessions(db: Db, now: number, limit = 20): SitterSessionView[] {
	return db
		.select()
		.from(sitterSessions)
		.orderBy(desc(sitterSessions.startAt))
		.limit(limit)
		.all()
		.map((r) => toView(r, now));
}

/** The active session, else the soonest scheduled one, else null. Ending is by the clock: no sweep. */
export function currentSession(db: Db, now: number): Row | null {
	const open = db
		.select()
		.from(sitterSessions)
		.orderBy(asc(sitterSessions.startAt))
		.all()
		.filter((r) => sessionStatus(r, now) !== 'ended');
	return open.find((r) => sessionStatus(r, now) === 'active') ?? open[0] ?? null;
}

/** The active session if `pin` is its PIN. A session without a PIN never matches. */
export function checkSitterPin(db: Db, pin: unknown, now: number): SitterSessionView | null {
	const row = currentSession(db, now);
	if (!row || typeof pin !== 'string') return null;
	const usable = pinUsable({ ...row, hasPin: row.pinHash !== null }, now);
	return usable && verifyPin(pin, row.pinHash) ? toView(row, now) : null;
}

export function listCheckins(db: Db, sessionId: string): Checkin[] {
	return db
		.select({ kind: sitterCheckins.kind, at: sitterCheckins.at })
		.from(sitterCheckins)
		.where(eq(sitterCheckins.sessionId, sessionId))
		.orderBy(asc(sitterCheckins.at))
		.all() as Checkin[];
}

export type CheckinOutcome =
	| { ok: true; at: number; kind: CheckinKind; sitterName: string | null }
	| { ok: false; status: 400 | 409 | 429; message: string; retryAfterMs?: number };

/** Stores a sitter's check-in on the active session, if the rules allow it. */
export function submitCheckin(db: Db, kind: unknown, now: number): CheckinOutcome {
	const row = currentSession(db, now);
	const history = row ? listCheckins(db, row.id) : [];
	const decision = decideCheckin(row, kind, history, now);
	if (!decision.ok) return decision;
	db.insert(sitterCheckins)
		.values({ id: randomUUID(), sessionId: row!.id, kind: decision.kind, at: now })
		.run();
	return { ok: true, at: now, kind: decision.kind, sitterName: row!.sitterName };
}

export interface SessionLogEntry extends SitterSessionView {
	checkins: Checkin[];
}

/** The last finished sessions with their check-ins, newest first, for the parents' log. */
export function sessionLog(db: Db, now: number, limit = LOG_SESSIONS): SessionLogEntry[] {
	return db
		.select()
		.from(sitterSessions)
		.orderBy(desc(sitterSessions.startAt))
		.all()
		.filter((r) => sessionStatus(r, now) === 'ended')
		.slice(0, limit)
		.map((r) => ({ ...toView(r, now), checkins: listCheckins(db, r.id) }));
}
