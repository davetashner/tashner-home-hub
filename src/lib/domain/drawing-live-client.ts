/**
 * Live shared board, client side (hub-cn7.30): the pure rules behind `LiveShare.svelte`; the wire
 * contract is `drawing-live.ts`. Each device draws locally (instant, with its own undo/redo) and
 * sends in the background. Other people's items live in a `Remote` board painted under the local
 * strokes; the echo of this device's own adds is skipped, since the stroke is already on screen.
 * Clear all is disabled while sharing, and undo only removes your own last item.
 */
import {
	applyEntries,
	parseEntry,
	type LiveBoard,
	type LiveEntry,
	type LiveEvent,
	type LiveItem
} from './drawing-live.js';

/** A fresh random id for this device; it authors every event it sends. */
export const newAuthor = (random: () => number = Math.random): string => {
	let id = 'd';
	for (let i = 0; i < 12; i++) id += Math.floor(random() * 36).toString(36);
	return id;
};

export interface Remote {
	me: string;
	/** Seq of the snapshot taken at join: this device's own items up to here are shown as remote. */
	joinSeq: number;
	board: LiveBoard;
	/** Entries that arrived ahead of a missing one, kept until it shows up or a resync. */
	buffer: readonly LiveEntry[];
}

export const joinRemote = (me: string, snapshot: LiveBoard): Remote => ({
	me,
	joinSeq: snapshot.seq,
	board: snapshot,
	buffer: []
});

/** Fold broadcast entries in. `gap` is true while some entry is missing (resync if it persists). */
export function feed(r: Remote, entries: readonly LiveEntry[]): { remote: Remote; gap: boolean } {
	const have = new Set(r.buffer.map((e) => e.seq));
	const fresh = entries.filter((e) => e.seq > r.board.seq && !have.has(e.seq));
	const { board } = applyEntries(r.board, [...r.buffer, ...fresh]);
	const buffer = [...r.buffer, ...fresh].filter((e) => e.seq > board.seq);
	return { remote: { ...r, board, buffer }, gap: buffer.length > 0 };
}

/** Replace the board with a fresh snapshot (reconnect or gap); older snapshots are ignored. */
export function resync(r: Remote, snapshot: LiveBoard): Remote {
	if (snapshot.seq < r.board.seq) return r;
	return feed({ ...r, board: snapshot, buffer: [] }, r.buffer).remote;
}

/** What to paint under the local strokes: everything except this device's own live adds. */
export const remoteItems = (r: Remote): LiveItem[] =>
	r.board.items.filter((i) => !(i.author === r.me && i.seq > r.joinSeq));

/**
 * What to send so the session matches the local strokes. `sent` is what was sent so far (by
 * identity); `holdLast` keeps back a just-placed shape that can still be moved or resized.
 * Strokes dropped from the end become undo events, new ones add events.
 */
export function diffLocal<T>(
	sent: readonly T[],
	strokes: readonly T[],
	holdLast: boolean
): { undos: number; adds: T[]; sent: T[] } {
	const target = holdLast ? strokes.slice(0, -1) : [...strokes];
	let p = 0;
	while (p < sent.length && p < target.length && sent[p] === target[p]) p++;
	return { undos: sent.length - p, adds: target.slice(p), sent: target };
}

/** The session id from an invitation frame (`{ session, started }`), or null. */
export const inviteFrom = (data: Record<string, string>): string | null =>
	data.started === '1' && typeof data.session === 'string' && /^[0-9a-f]{8}$/.test(data.session)
		? data.session
		: null;

/** The entry of an event frame for `session`, or null for another session or a bad frame. */
export function entryFor(data: Record<string, string>, session: string): LiveEntry | null {
	if (data.session !== session || typeof data.entry !== 'string') return null;
	try {
		return parseEntry(JSON.parse(data.entry));
	} catch {
		return null;
	}
}

export type SendResult = { ok: true; entry: LiveEntry } | { ok: false; retry: boolean };

export interface SenderOptions {
	send: (event: LiveEvent) => Promise<SendResult>;
	/** The server's stamped entry for a sent event. */
	onEntry: (entry: LiveEntry) => void;
	/** An event the server refused for good (board full, nothing to undo). */
	onDrop?: (event: LiveEvent) => void;
	onStatus?: (online: boolean) => void;
	wait?: (ms: number) => Promise<void>;
}

export const RETRY_START_MS = 1_000;
export const RETRY_MAX_MS = 8_000;

/**
 * Sends events one at a time, in order. A network failure keeps the event at the head of the
 * queue and retries with backoff (or at once on `kick`), so drawing never waits on the network.
 */
export function createSender(o: SenderOptions) {
	const queue: LiveEvent[] = [];
	let running = false;
	let wake: (() => void) | null = null;
	let stopped = false;
	const wait =
		o.wait ??
		((ms: number) =>
			new Promise<void>((res) => {
				const t = setTimeout(res, ms);
				wake = () => {
					clearTimeout(t);
					res();
				};
			}));

	async function run() {
		if (running) return;
		running = true;
		let delay = RETRY_START_MS;
		while (queue.length > 0 && !stopped) {
			const head = queue[0];
			const r = await o.send(head);
			if (stopped) break;
			if (r.ok) {
				queue.shift();
				delay = RETRY_START_MS;
				o.onStatus?.(true);
				o.onEntry(r.entry);
			} else if (!r.retry) {
				queue.shift();
				o.onDrop?.(head);
			} else {
				o.onStatus?.(false);
				await wait(delay);
				wake = null;
				delay = Math.min(RETRY_MAX_MS, delay * 2);
			}
		}
		running = false;
	}

	return {
		enqueue(event: LiveEvent) {
			queue.push(event);
			void run();
		},
		/** The connection is back: retry now. */
		kick() {
			wake?.();
			void run();
		},
		stop() {
			stopped = true;
			queue.length = 0;
			wake?.();
		}
	};
}
