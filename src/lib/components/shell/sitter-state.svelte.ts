import { effectiveEnd, type SitterCard, type WallSession } from '#lib/domain/sitter.js';

/**
 * The wall's copy of the current sitter session (hub-7pj.2). One poll a few seconds apart keeps it
 * fresh, and a clock tick re-evaluates it, so a session that ends by its own end time hands the
 * wall back without waiting for the next poll. Everything here is in memory: a reload asks for the
 * sitter PIN again.
 */
export const sitter = $state({
	session: null as WallSession | null,
	card: null as SitterCard | null,
	/** The session the card belongs to, so a new session never inherits an old card. */
	cardFor: null as string | null,
	/** House rules and bedtimes: sent while active, before any PIN. */
	tonight: null as { rules: string[]; bedtimes: { memberId: string; bedtime: string }[] } | null,
	now: Date.now(),
	emergencyOpen: false,
	approvalsOpen: false,
	/** The sitter PIN once accepted, kept in memory only so each approval is not a new PIN entry. */
	pin: null as string | null
});

export const POLL_MS = 15_000;
export const TICK_MS = 5_000;

let lastId: string | null = null;

function setSession(
	session: WallSession | null,
	card: SitterCard | null,
	tonight: typeof sitter.tonight = sitter.tonight
) {
	sitter.tonight = session ? tonight : null;
	if ((session?.id ?? null) !== lastId) {
		// A different (or no) session: nothing learned from the last one carries over.
		lastId = session?.id ?? null;
		sitter.card = null;
		sitter.cardFor = null;
		sitter.pin = null;
	}
	sitter.session = session;
	if (session && card) {
		sitter.card = card;
		sitter.cardFor = session.id;
	}
	if (!session) {
		sitter.emergencyOpen = false;
		sitter.approvalsOpen = false;
	}
}

export async function refreshSitter(): Promise<void> {
	try {
		const res = await fetch('/api/sitter/current');
		if (!res.ok) return;
		const body = (await res.json()) as {
			session: WallSession | null;
			card: SitterCard | null;
			tonight: typeof sitter.tonight;
		};
		setSession(body.session, body.card, body.tonight);
	} catch {
		// Offline blip: keep what we have; the clock still ends the session on time.
	}
	sitter.now = Date.now();
}

/** Called after the sitter PIN was accepted: remember the card for this session. */
export function unlockCard(session: WallSession, card: SitterCard) {
	setSession(session, card);
}

/** Starts polling and ticking; returns the stop function. */
export function watchSitter(): () => void {
	void refreshSitter();
	const poll = setInterval(() => void refreshSitter(), POLL_MS);
	const tick = setInterval(() => {
		const before = sitter.now;
		sitter.now = Date.now();
		const s = sitter.session;
		// The session just started (its card is only sent while active) or just ended: ask again.
		const crossed = (at: number) => at > before && at <= sitter.now;
		if (s && (crossed(s.startAt) || crossed(effectiveEnd(s)))) void refreshSitter();
	}, TICK_MS);
	const onVisible = () => document.visibilityState === 'visible' && void refreshSitter();
	document.addEventListener('visibilitychange', onVisible);
	return () => {
		clearInterval(poll);
		clearInterval(tick);
		document.removeEventListener('visibilitychange', onVisible);
	};
}
