/**
 * Live shared drawing sessions (hub-cn7.29). One session is one board that several devices draw
 * on at once. Ordering and merge rules are pure and live in `#lib/domain/drawing-live.js`; this
 * module holds the sessions and relays each accepted entry over the existing SSE hub
 * (topic `drawing`, data `{ session, entry }` with `entry` as JSON). Opening a session also
 * publishes `{ session, started: '1' }` so idle devices can offer to join.
 *
 * Sessions live in memory only: the server is a single container and a board that has nobody
 * on it is not worth keeping, so a restart simply ends them (clients see a 404 and stop). A
 * session expires after SESSION_IDLE_MS without an event or a snapshot fetch; expiry is checked
 * lazily on every access, with no timer to leak. At most MAX_SESSIONS exist at once.
 */
import { randomBytes } from 'node:crypto';
import {
	emptyBoard,
	isAuthor,
	parseEvent,
	sequenceEvent,
	toSnapshot,
	type LiveBoard,
	type LiveEntry
} from '#lib/domain/drawing-live.js';
import {
	dropped,
	guess,
	publicRound,
	startRound,
	touch,
	type GuessResult,
	type PublicRound,
	type Round
} from '#lib/domain/drawing-guess.js';
import { publish } from './events.js';
import { LedgerError } from './ledger.js';

export const SESSION_IDLE_MS = 30 * 60_000;
export const MAX_SESSIONS = 8;
/** Largest request body for an event; one stroke is a few KB, so this is generous. */
export const MAX_EVENT_BODY = 150_000;

interface Session {
	id: string;
	board: LiveBoard;
	lastActive: number;
	/** The draw-and-guess round in progress, if any (hub-t27j.10). */
	game: Round | null;
}

const sessions = new Map<string, Session>();

const sweep = (now: number) => {
	for (const [id, s] of sessions) if (now - s.lastActive > SESSION_IDLE_MS) sessions.delete(id);
};

function get(id: string, now: number): Session {
	sweep(now);
	const s = sessions.get(id);
	if (!s) throw new LedgerError('not_found', 'That drawing session has ended');
	s.lastActive = now;
	return s;
}

/** Opens a new empty session; the id doubles as the join code. */
export function openSession(now = Date.now()): { id: string; seq: number } {
	sweep(now);
	if (sessions.size >= MAX_SESSIONS)
		throw new LedgerError('conflict', 'Too many live drawing sessions are open');
	const id = randomBytes(4).toString('hex');
	sessions.set(id, { id, board: emptyBoard(), lastActive: now, game: null });
	// Invitation for the other devices: `{ session, started }`, no entry (hub-cn7.30).
	publish('drawing', { session: id, started: '1' });
	return { id, seq: 0 };
}

/** Current board for a joiner: items so far plus the seq to continue from. */
export function snapshotSession(id: string, now = Date.now()) {
	return { id, ...toSnapshot(get(id, now).board) };
}

/** Validates, orders and broadcasts one event; returns the stamped entry. */
export function postEvent(
	id: string,
	author: unknown,
	rawEvent: unknown,
	now = Date.now()
): LiveEntry {
	if (!isAuthor(author)) throw new LedgerError('invalid', 'author must be a short string');
	const event = parseEvent(rawEvent);
	if (!event) throw new LedgerError('invalid', 'event is not a valid drawing event');
	const s = get(id, now);
	const r = sequenceEvent(s.board, author, event);
	if ('reject' in r)
		throw new LedgerError(
			r.reject === 'full' ? 'conflict' : 'not_found',
			r.reject === 'full' ? 'The board is full' : 'Nothing of yours to undo'
		);
	s.board = r.board;
	publish('drawing', { session: id, entry: JSON.stringify(r.entry) });
	return r.entry;
}

/** Test hook: forget every session. */
export const resetSessions = () => sessions.clear();

export interface GameReply {
	/** What every board may see; null when no round is on. */
	game: PublicRound | null;
	/** The secret word, sent only to the drawer. */
	word?: string;
	result?: GuessResult;
}

const reply = (r: Round | null, author: string, result?: GuessResult): GameReply => ({
	game: r ? publicRound(r) : null,
	...(r && r.drawer === author ? { word: r.word } : {}),
	...(result ? { result } : {})
});

const announce = (id: string, r: Round | null) =>
	publish('drawing', { session: id, game: JSON.stringify(r ? publicRound(r) : null) });

/**
 * Draw-and-guess actions on a session: `start` (a first round, or a new one with the roles
 * swapped), `guess` (`index` into the choices), `ping` (a board checking in) and `leave`.
 * The word never leaves the server except in the drawer's own reply. A round ends when either
 * player leaves or goes quiet; the next ping from the other board finds out.
 */
export function gameAction(
	id: string,
	author: unknown,
	body: Record<string, unknown>,
	now = Date.now(),
	rand: () => number = Math.random
): GameReply {
	if (!isAuthor(author)) throw new LedgerError('invalid', 'author must be a short string');
	const s = get(id, now);
	const end = () => {
		if (s.game) announce(id, null);
		s.game = null;
		return reply(null, author);
	};
	switch (body.action) {
		case 'start':
			s.game = startRound(s.game, author, now, rand);
			announce(id, s.game);
			return reply(s.game, author);
		case 'leave':
			return end();
		case 'ping': {
			if (!s.game) return reply(null, author);
			const before = s.game.v;
			s.game = touch(s.game, author, now);
			if (dropped(s.game, now)) return end();
			if (s.game.v !== before) announce(id, s.game);
			return reply(s.game, author);
		}
		case 'guess': {
			if (!s.game) return reply(null, author);
			const r = guess(s.game, author, body.index);
			s.game = r.round;
			if (r.result !== 'ignored') announce(id, s.game);
			return reply(s.game, author, r.result);
		}
		default:
			throw new LedgerError('invalid', 'unknown game action');
	}
}
