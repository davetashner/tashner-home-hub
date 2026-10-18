/**
 * Sitter mode (hub-7pj): the household info card and a sitter session's lifecycle.
 * Pure: no clock, no database. Callers pass `now` (epoch ms).
 */

export type SessionStatus = 'scheduled' | 'active' | 'ended';

export interface SessionTimes {
	startAt: number;
	endAt: number;
	/** Set when a parent ends the session early. */
	endedAt: number | null;
}

export interface SitterPermissions {
	/** The sitter may approve or reject Star Jobs. */
	approveJobs: boolean;
	/** Games and Music stay available (no "finish your jobs first" lock). */
	funAllowed: boolean;
}

export const MAX_SESSION_MS = 3 * 24 * 60 * 60 * 1000;

export type Result<T> = { ok: true; value: T } | { ok: false; message: string };

/** Scheduled before the start, active until the end (or an early end), ended after. */
export function sessionStatus(s: SessionTimes, now: number): SessionStatus {
	if (s.endedAt !== null && now >= s.endedAt) return 'ended';
	if (now >= s.endAt) return 'ended';
	return now < s.startAt ? 'scheduled' : 'active';
}

/** When the session stops mattering: the early end if there was one, else the planned end. */
export function effectiveEnd(s: SessionTimes): number {
	return s.endedAt === null ? s.endAt : Math.min(s.endAt, s.endedAt);
}

export interface SessionInput {
	startAt?: unknown;
	endAt?: unknown;
}

const isMs = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** Validates a new session's window. A missing start means now. */
export function validateWindow(
	input: SessionInput,
	now: number
): Result<{ startAt: number; endAt: number }> {
	const startAt = input.startAt === undefined || input.startAt === null ? now : input.startAt;
	if (!isMs(startAt)) return { ok: false, message: 'Start time is not a valid time.' };
	if (!isMs(input.endAt)) return { ok: false, message: 'End time is required.' };
	if (input.endAt <= now) return { ok: false, message: 'End time must be in the future.' };
	if (input.endAt <= startAt) return { ok: false, message: 'End time must be after the start.' };
	if (input.endAt - startAt > MAX_SESSION_MS)
		return { ok: false, message: 'A session can last at most 3 days.' };
	return { ok: true, value: { startAt, endAt: input.endAt } };
}

/** Whether [startAt, endAt) overlaps a session that has not ended yet. */
export function overlapsOpenSession(
	existing: SessionTimes[],
	window: { startAt: number; endAt: number },
	now: number
): boolean {
	return existing.some(
		(s) =>
			sessionStatus(s, now) !== 'ended' &&
			window.startAt < effectiveEnd(s) &&
			s.startAt < window.endAt
	);
}

/** New end time for a session that is still running or scheduled. Only later than the current end. */
export function extendedEnd(s: SessionTimes, newEndAt: unknown, now: number): Result<number> {
	if (sessionStatus(s, now) === 'ended') return { ok: false, message: 'That session has ended.' };
	if (!isMs(newEndAt)) return { ok: false, message: 'End time is not a valid time.' };
	if (newEndAt <= s.endAt) return { ok: false, message: 'Extend to a later time.' };
	if (newEndAt - s.startAt > MAX_SESSION_MS)
		return { ok: false, message: 'A session can last at most 3 days.' };
	return { ok: true, value: newEndAt };
}

/** The sitter PIN only works while the session is active. */
export function pinUsable(s: SessionTimes & { hasPin: boolean }, now: number): boolean {
	return s.hasPin && sessionStatus(s, now) === 'active';
}

/** Permission checks for the wall (hub-7pj.2). Nothing is granted outside an active session. */
export function sitterCan(
	s: (SessionTimes & SitterPermissions) | null,
	what: keyof SitterPermissions,
	now: number
): boolean {
	return s !== null && sessionStatus(s, now) === 'active' && s[what];
}

export function validateSitterPin(pin: unknown): Result<string> {
	if (typeof pin !== 'string' || !/^\d{4}$/.test(pin))
		return { ok: false, message: 'The sitter PIN is 4 digits.' };
	return { ok: true, value: pin };
}

// ---- Check-ins ----

export const CHECKIN_KINDS = ['in-bed', 'all-good', 'call-me'] as const;
export type CheckinKind = (typeof CHECKIN_KINDS)[number];
/** The same button can be tapped again after this long. */
export const CHECKIN_INTERVAL_MS = 60_000;

export interface Checkin {
	kind: CheckinKind;
	at: number;
}

export const isCheckinKind = (v: unknown): v is CheckinKind =>
	typeof v === 'string' && (CHECKIN_KINDS as readonly string[]).includes(v);

/** Milliseconds until `kind` may be sent again; 0 when it may be sent now. */
export function checkinWaitMs(history: Checkin[], kind: CheckinKind, now: number): number {
	const last = history.reduce((m, c) => (c.kind === kind && c.at > m ? c.at : m), -Infinity);
	return Math.max(0, last + CHECKIN_INTERVAL_MS - now);
}

export type CheckinDecision =
	| { ok: true; kind: CheckinKind }
	| { ok: false; status: 400 | 409 | 429; message: string; retryAfterMs?: number };

/** Check-ins need a known kind and an active session, at most one per kind per minute. */
export function decideCheckin(
	session: SessionTimes | null,
	kind: unknown,
	history: Checkin[],
	now: number
): CheckinDecision {
	if (!isCheckinKind(kind)) return { ok: false, status: 400, message: 'Unknown check-in.' };
	if (!session || sessionStatus(session, now) !== 'active')
		return { ok: false, status: 409, message: 'There is no active sitter session.' };
	const wait = checkinWaitMs(history, kind, now);
	if (wait > 0)
		return { ok: false, status: 429, message: 'Already sent. Try again soon.', retryAfterMs: wait };
	return { ok: true, kind };
}

// ---- The info card ----

export interface Contact {
	name: string;
	relation: string;
	phone: string;
}

export interface KidInfo {
	memberId: string;
	/** "HH:MM", 24 hour, or empty. */
	bedtime: string;
	allergies: string;
	medical: string;
}

export interface SitterCard {
	contacts: Contact[];
	address: string;
	kids: KidInfo[];
	rules: string[];
	wifiName: string;
	wifiPassword: string;
	tonight: string;
}

export const MAX_CONTACTS = 10;
export const MAX_RULES = 15;
export const MAX_KIDS = 12;

export function emptyCard(): SitterCard {
	return {
		contacts: [],
		address: '',
		kids: [],
		rules: [],
		wifiName: '',
		wifiPassword: '',
		tonight: ''
	};
}

const text = (v: unknown, max: number): string =>
	typeof v === 'string' ? v.trim().slice(0, max) : '';
const obj = (v: unknown): Record<string, unknown> =>
	v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const list = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);

/** Coerces untrusted input into a well-formed card: trims, caps lengths and counts, drops blanks. */
export function normalizeCard(raw: unknown): SitterCard {
	const r = obj(raw);
	const contacts = list(r.contacts, MAX_CONTACTS)
		.map((c) => {
			const o = obj(c);
			return { name: text(o.name, 60), relation: text(o.relation, 40), phone: text(o.phone, 30) };
		})
		.filter((c) => c.name || c.phone);
	const kids = list(r.kids, MAX_KIDS)
		.map((k) => {
			const o = obj(k);
			const bedtime = text(o.bedtime, 5);
			return {
				memberId: text(o.memberId, 80),
				bedtime: /^([01]\d|2[0-3]):[0-5]\d$/.test(bedtime) ? bedtime : '',
				allergies: text(o.allergies, 500),
				medical: text(o.medical, 1000)
			};
		})
		.filter((k) => k.memberId);
	return {
		contacts,
		address: text(r.address, 200),
		kids,
		rules: list(r.rules, MAX_RULES)
			.map((x) => text(x, 200))
			.filter(Boolean),
		wifiName: text(r.wifiName, 64),
		wifiPassword: text(r.wifiPassword, 64),
		tonight: text(r.tonight, 1000)
	};
}

/** The parts encrypted at rest: phones, address, allergies and medical notes, Wi-Fi password. */
export interface SensitiveCard {
	phones: string[];
	address: string;
	kids: { memberId: string; allergies: string; medical: string }[];
	wifiPassword: string;
}

export type PlainCard = {
	contacts: Omit<Contact, 'phone'>[];
	kids: { memberId: string; bedtime: string }[];
	rules: string[];
	wifiName: string;
	tonight: string;
};

export function splitCard(card: SitterCard): { plain: PlainCard; sensitive: SensitiveCard } {
	return {
		plain: {
			contacts: card.contacts.map(({ name, relation }) => ({ name, relation })),
			kids: card.kids.map(({ memberId, bedtime }) => ({ memberId, bedtime })),
			rules: card.rules,
			wifiName: card.wifiName,
			tonight: card.tonight
		},
		sensitive: {
			phones: card.contacts.map((c) => c.phone),
			address: card.address,
			kids: card.kids.map(({ memberId, allergies, medical }) => ({ memberId, allergies, medical })),
			wifiPassword: card.wifiPassword
		}
	};
}

export function joinCard(plain: PlainCard, sensitive: SensitiveCard): SitterCard {
	return {
		contacts: plain.contacts.map((c, i) => ({ ...c, phone: sensitive.phones[i] ?? '' })),
		address: sensitive.address,
		kids: plain.kids.map((k) => {
			const s = sensitive.kids.find((x) => x.memberId === k.memberId);
			return { ...k, allergies: s?.allergies ?? '', medical: s?.medical ?? '' };
		}),
		rules: plain.rules,
		wifiName: plain.wifiName,
		wifiPassword: sensitive.wifiPassword,
		tonight: plain.tonight
	};
}
