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
	sessions.set(id, { id, board: emptyBoard(), lastActive: now });
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
