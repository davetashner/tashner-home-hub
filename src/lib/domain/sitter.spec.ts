import { describe, expect, it } from 'vitest';
import {
	CHECKIN_KINDS,
	checkinWaitMs,
	decideCheckin,
	isCheckinKind,
	emptyCard,
	effectiveEnd,
	extendedEnd,
	joinCard,
	MAX_SESSION_MS,
	normalizeCard,
	overlapsOpenSession,
	pinUsable,
	sessionStatus,
	sitterCan,
	sitterLocks,
	isFunPath,
	backAroundLabel,
	splitCard,
	validateSitterPin,
	validateWindow
} from './sitter.js';

const H = 3_600_000;
const NOW = 1_000_000_000_000;
const s = (startAt: number, endAt: number, endedAt: number | null = null) => ({
	startAt,
	endAt,
	endedAt
});

describe('sessionStatus', () => {
	it('is scheduled, active, then ended by the clock', () => {
		const x = s(NOW + H, NOW + 4 * H);
		expect(sessionStatus(x, NOW)).toBe('scheduled');
		expect(sessionStatus(x, NOW + H)).toBe('active');
		expect(sessionStatus(x, NOW + 4 * H - 1)).toBe('active');
		expect(sessionStatus(x, NOW + 4 * H)).toBe('ended');
	});
	it('ends early when a parent ends it', () => {
		const x = s(NOW, NOW + 4 * H, NOW + H);
		expect(sessionStatus(x, NOW + H - 1)).toBe('active');
		expect(sessionStatus(x, NOW + H)).toBe('ended');
		expect(effectiveEnd(x)).toBe(NOW + H);
		expect(effectiveEnd(s(NOW, NOW + H))).toBe(NOW + H);
	});
	it('cancels a scheduled session by ending it', () => {
		expect(sessionStatus(s(NOW + H, NOW + 2 * H, NOW), NOW)).toBe('ended');
	});
});

describe('validateWindow', () => {
	it('defaults the start to now', () => {
		expect(validateWindow({ endAt: NOW + H }, NOW)).toEqual({
			ok: true,
			value: { startAt: NOW, endAt: NOW + H }
		});
		expect(validateWindow({ startAt: null, endAt: NOW + H }, NOW).ok).toBe(true);
	});
	it.each([
		[{ startAt: 'x', endAt: NOW + H }, /Start/],
		[{}, /End time is required/],
		[{ endAt: NOW - 1 }, /future/],
		[{ startAt: NOW + 2 * H, endAt: NOW + H }, /after the start/],
		[{ endAt: NOW + MAX_SESSION_MS + 1 }, /3 days/]
	])('rejects %j', (input, msg) => {
		const r = validateWindow(input, NOW);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.message).toMatch(msg);
	});
});

describe('overlapsOpenSession', () => {
	const open = [s(NOW + 2 * H, NOW + 5 * H)];
	it('detects overlap with an open session', () => {
		expect(overlapsOpenSession(open, { startAt: NOW, endAt: NOW + 3 * H }, NOW)).toBe(true);
		expect(overlapsOpenSession(open, { startAt: NOW + 4 * H, endAt: NOW + 6 * H }, NOW)).toBe(true);
	});
	it('allows back-to-back and ignores ended sessions', () => {
		expect(overlapsOpenSession(open, { startAt: NOW + 5 * H, endAt: NOW + 6 * H }, NOW)).toBe(
			false
		);
		expect(overlapsOpenSession(open, { startAt: NOW, endAt: NOW + 2 * H }, NOW)).toBe(false);
		const ended = [s(NOW - 3 * H, NOW - H)];
		expect(overlapsOpenSession(ended, { startAt: NOW, endAt: NOW + H }, NOW)).toBe(false);
	});
});

describe('extendedEnd', () => {
	const x = s(NOW, NOW + 2 * H);
	it('moves the end later', () => {
		expect(extendedEnd(x, NOW + 3 * H, NOW)).toEqual({ ok: true, value: NOW + 3 * H });
	});
	it.each([
		[s(NOW - 3 * H, NOW - H), NOW + H, /ended/],
		[x, 'x', /valid/],
		[x, NOW + H, /later/],
		[x, NOW + MAX_SESSION_MS + 1, /3 days/]
	])('rejects %#', (sess, end, msg) => {
		const r = extendedEnd(sess, end, NOW);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.message).toMatch(msg);
	});
});

describe('PIN and permissions', () => {
	it('the PIN is usable only while active and set', () => {
		const x = { ...s(NOW + H, NOW + 3 * H), hasPin: true };
		expect(pinUsable(x, NOW)).toBe(false);
		expect(pinUsable(x, NOW + H)).toBe(true);
		expect(pinUsable(x, NOW + 3 * H)).toBe(false);
		expect(pinUsable({ ...x, hasPin: false }, NOW + H)).toBe(false);
	});
	it('validates a 4-digit PIN', () => {
		expect(validateSitterPin('0420')).toEqual({ ok: true, value: '0420' });
		for (const bad of ['123', '12345', 'abcd', 1234, null]) {
			expect(validateSitterPin(bad).ok).toBe(false);
		}
	});
	it('grants permissions only during an active session', () => {
		const x = { ...s(NOW, NOW + H), approveJobs: true, funAllowed: false };
		expect(sitterCan(x, 'approveJobs', NOW)).toBe(true);
		expect(sitterCan(x, 'funAllowed', NOW)).toBe(false);
		expect(sitterCan(x, 'approveJobs', NOW + H)).toBe(false);
		expect(sitterCan({ ...x, startAt: NOW + H, endAt: NOW + 2 * H }, 'approveJobs', NOW)).toBe(
			false
		);
		expect(sitterCan(null, 'approveJobs', NOW)).toBe(false);
	});
});

describe('card', () => {
	const raw = {
		contacts: [
			{ name: ' Grandma ', relation: 'Grandmother', phone: '555-0101' },
			{ name: '', phone: '' }
		],
		address: '1 Test Lane',
		kids: [
			{ memberId: 'a', bedtime: '19:30', allergies: 'Peanuts', medical: 'Inhaler' },
			{ memberId: 'b', bedtime: '25:00' },
			{ memberId: '' }
		],
		rules: ['No screens', '  ', 'Lights out at bedtime'],
		wifiName: 'TestNet',
		wifiPassword: 'hunter2',
		tonight: 'Pizza in the freezer'
	};
	it('normalizes untrusted input', () => {
		const c = normalizeCard(raw);
		expect(c.contacts).toEqual([{ name: 'Grandma', relation: 'Grandmother', phone: '555-0101' }]);
		expect(c.kids.map((k) => k.bedtime)).toEqual(['19:30', '']);
		expect(c.rules).toEqual(['No screens', 'Lights out at bedtime']);
	});
	it('handles junk', () => {
		expect(normalizeCard(null)).toEqual(emptyCard());
		expect(normalizeCard([]).contacts).toEqual([]);
		expect(normalizeCard({ contacts: 'x', rules: 5, kids: {} })).toEqual(emptyCard());
	});
	it('caps lengths and counts', () => {
		const c = normalizeCard({ tonight: 'x'.repeat(5000), rules: Array(40).fill('r') });
		expect(c.tonight).toHaveLength(1000);
		expect(c.rules).toHaveLength(15);
	});
	it('splits sensitive fields out and joins them back', () => {
		const card = normalizeCard(raw);
		const { plain, sensitive } = splitCard(card);
		expect(JSON.stringify(plain)).not.toMatch(/555|Test Lane|Peanuts|Inhaler|hunter2/);
		expect(sensitive.phones).toEqual(['555-0101']);
		expect(joinCard(plain, sensitive)).toEqual(card);
	});
	it('joins tolerate missing sensitive entries', () => {
		const { plain } = splitCard(normalizeCard(raw));
		const c = joinCard(plain, { phones: [], address: '', kids: [], wifiPassword: '' });
		expect(c.contacts[0]?.phone).toBe('');
		expect(c.kids[0]?.allergies).toBe('');
	});
});

describe('check-ins', () => {
	const session = { startAt: 1000, endAt: 100_000, endedAt: null };
	it('knows the kinds', () => {
		expect(CHECKIN_KINDS.every(isCheckinKind)).toBe(true);
		expect(isCheckinKind('nope')).toBe(false);
		expect(isCheckinKind(3)).toBe(false);
	});
	it('rejects unknown kinds before anything else', () => {
		expect(decideCheckin(null, 'x', [], 5000)).toMatchObject({ ok: false, status: 400 });
	});
	it('needs an active session', () => {
		expect(decideCheckin(null, 'all-good', [], 5000)).toMatchObject({ ok: false, status: 409 });
		expect(decideCheckin(session, 'all-good', [], 500)).toMatchObject({ status: 409 });
		expect(decideCheckin(session, 'all-good', [], 100_000)).toMatchObject({ status: 409 });
		expect(decideCheckin({ ...session, endedAt: 4000 }, 'all-good', [], 5000)).toMatchObject({
			status: 409
		});
		expect(decideCheckin(session, 'all-good', [], 5000)).toEqual({ ok: true, kind: 'all-good' });
	});
	it('allows one per kind per minute', () => {
		const history = [{ kind: 'in-bed' as const, at: 10_000 }];
		expect(checkinWaitMs(history, 'in-bed', 40_000)).toBe(30_000);
		expect(checkinWaitMs(history, 'in-bed', 70_000)).toBe(0);
		expect(checkinWaitMs(history, 'call-me', 11_000)).toBe(0);
		expect(decideCheckin(session, 'in-bed', history, 40_000)).toMatchObject({
			ok: false,
			status: 429,
			retryAfterMs: 30_000
		});
		expect(decideCheckin(session, 'in-bed', history, 70_000)).toMatchObject({ ok: true });
		expect(decideCheckin(session, 'call-me', history, 11_000)).toMatchObject({ ok: true });
	});
});

describe('wall locks (hub-7pj.2)', () => {
	const base = {
		id: 's',
		sitterName: null,
		hasPin: false,
		startAt: 1000,
		endAt: 5000,
		endedAt: null,
		approveJobs: false,
		funAllowed: true
	};

	it('holds nothing before the start or after the end', () => {
		expect(sitterLocks(null, 2000, false).adultLocked).toBe(false);
		expect(sitterLocks(base, 500, false).sitterView).toBe(false);
		expect(sitterLocks(base, 5000, false).sitterView).toBe(false);
		expect(sitterLocks({ ...base, endedAt: 2000 }, 3000, false).adultLocked).toBe(false);
	});

	it('locks adult parts while active, but never for an adult', () => {
		expect(sitterLocks(base, 2000, false)).toMatchObject({ sitterView: true, adultLocked: true });
		expect(sitterLocks(base, 2000, true)).toMatchObject({ sitterView: true, adultLocked: false });
	});

	it('hides Games and Music only when fun is off', () => {
		expect(sitterLocks(base, 2000, false).funHidden).toBe(false);
		expect(sitterLocks({ ...base, funAllowed: false }, 2000, false).funHidden).toBe(true);
		expect(sitterLocks({ ...base, funAllowed: false }, 2000, true).funHidden).toBe(false);
	});

	it('lets the sitter approve only when the parents allowed it', () => {
		expect(sitterLocks(base, 2000, false).canApprove).toBe(false);
		expect(sitterLocks({ ...base, approveJobs: true }, 2000, false).canApprove).toBe(true);
		expect(sitterLocks({ ...base, approveJobs: true }, 9000, false).canApprove).toBe(false);
	});

	it('knows the fun paths', () => {
		expect(isFunPath('/games')).toBe(true);
		expect(isFunPath('/music/queue')).toBe(true);
		expect(isFunPath('/gamesx')).toBe(false);
		expect(isFunPath('/chores')).toBe(false);
	});

	it('labels the end time, with the weekday only on another day', () => {
		const tz = 'UTC';
		const now = Date.UTC(2026, 9, 17, 18, 0);
		expect(backAroundLabel(Date.UTC(2026, 9, 17, 21, 0), now, tz)).toBe('9 PM');
		expect(backAroundLabel(Date.UTC(2026, 9, 17, 21, 30), now, tz)).toBe('9:30 PM');
		expect(backAroundLabel(Date.UTC(2026, 9, 18, 1, 0), now, tz)).toBe('Sun 1 AM');
	});
});
