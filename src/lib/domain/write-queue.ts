/**
 * Offline write queue for kid actions (NFR-6). Pure logic: storage, transport and clock are
 * injected so ordering, retry and expiry are unit-testable. Replays are safe because the ledger
 * is idempotent per chore/member/day and each write also carries an Idempotency-Key.
 */

import { setStatus, type KidGroup } from './kid-chores.js';

export type WriteKind = 'complete' | 'undo';
export type SendResult = 'ok' | 'retry' | 'drop';
export type DropReason = 'expired' | 'rejected';

export interface QueuedWrite {
	id: string;
	/** Sent as the Idempotency-Key header; stable across retries. */
	key: string;
	kind: WriteKind;
	url: string;
	body: unknown;
	/** The chore this write concerns (lets an undo cancel a not-yet-sent completion). */
	choreId: string;
	queuedAt: number;
	/** Undo only: after this instant the server would refuse, so the write is dropped unsent. */
	expiresAt: number | null;
	attempts: number;
	nextAt: number;
}

export type NewWrite = Pick<QueuedWrite, 'kind' | 'url' | 'body' | 'choreId'> & {
	expiresAt?: number | null;
};

export interface QueueStorage {
	load(): Promise<QueuedWrite[]>;
	save(items: QueuedWrite[]): Promise<void>;
}

export interface QueueDeps {
	storage: QueueStorage;
	send: (write: QueuedWrite) => Promise<SendResult>;
	now: () => number;
	newId: () => string;
	onDrop?: (write: QueuedWrite, reason: DropReason) => void;
	onChange?: (size: number) => void;
}

const BASE_MS = 1_000;
const MAX_MS = 60_000;

/** 1 s, 2 s, 4 s ... capped at one minute. */
export function backoffMs(attempts: number): number {
	return Math.min(MAX_MS, BASE_MS * 2 ** Math.max(0, attempts - 1));
}

export class WriteQueue {
	#items: QueuedWrite[] | null = null;
	#flushing: Promise<number> | null = null;
	readonly #deps: QueueDeps;

	constructor(deps: QueueDeps) {
		this.#deps = deps;
	}

	async #list(): Promise<QueuedWrite[]> {
		this.#items ??= await this.#deps.storage.load();
		return this.#items;
	}

	async #commit(items: QueuedWrite[]): Promise<void> {
		this.#items = items;
		await this.#deps.storage.save(items);
		this.#deps.onChange?.(items.length);
	}

	async size(): Promise<number> {
		return (await this.#list()).length;
	}

	async pending(): Promise<readonly QueuedWrite[]> {
		return [...(await this.#list())];
	}

	async enqueue(input: NewWrite): Promise<QueuedWrite> {
		const items = await this.#list();
		const now = this.#deps.now();
		const id = this.#deps.newId();
		const write: QueuedWrite = {
			id,
			key: id,
			kind: input.kind,
			url: input.url,
			body: input.body,
			choreId: input.choreId,
			queuedAt: now,
			expiresAt: input.expiresAt ?? null,
			attempts: 0,
			nextAt: now
		};
		await this.#commit([...items, write]);
		return write;
	}

	/** Takes back a completion that was never sent. Returns false if it already went out. */
	async cancelComplete(choreId: string): Promise<boolean> {
		const items = await this.#list();
		const next = items.filter((w) => !(w.kind === 'complete' && w.choreId === choreId));
		if (next.length === items.length) return false;
		await this.#commit(next);
		return true;
	}

	/** Replays in order; stops at the first write that must wait (`force` ignores backoff, e.g. on reconnect). Resolves to how many were sent. */
	flush(force = false): Promise<number> {
		// A forced flush (reconnect) must not just join a run that may be failing offline: queue behind it.
		if (this.#flushing && force) return this.#flushing.then(() => this.flush(true));
		this.#flushing ??= this.#run(force).finally(() => (this.#flushing = null));
		return this.#flushing;
	}

	async #run(force: boolean): Promise<number> {
		let sent = 0;
		for (;;) {
			const [head] = await this.#list();
			if (!head || (!force && head.nextAt > this.#deps.now())) return sent;
			const result =
				head.expiresAt !== null && this.#deps.now() > head.expiresAt
					? 'expired'
					: await this.#deps.send(head);
			if (result === 'retry') {
				const attempts = head.attempts + 1;
				const retried = { ...head, attempts, nextAt: this.#deps.now() + backoffMs(attempts) };
				await this.#commit((await this.#list()).map((w) => (w.id === head.id ? retried : w)));
				return sent;
			}
			await this.#commit((await this.#list()).filter((w) => w.id !== head.id));
			if (result === 'ok') sent += 1;
			else this.#deps.onDrop?.(head, result === 'expired' ? 'expired' : 'rejected');
		}
	}
}

/** Maps an HTTP status to what the queue should do with the write. */
export function classifyStatus(status: number): SendResult {
	if (status >= 200 && status < 300) return 'ok';
	if (status >= 500 || status === 408 || status === 429) return 'retry';
	return 'drop';
}

/** Shows queued taps on a board loaded from the saved copy, so a reload offline still looks right. */
export function overlayQueued(
	groups: KidGroup[],
	memberId: string,
	writes: readonly QueuedWrite[]
): KidGroup[] {
	return writes.reduce((acc, w) => {
		const body = w.body as { memberId?: string } | null;
		if (w.kind === 'complete' && body?.memberId === memberId)
			return setStatus(acc, w.choreId, 'pending', null);
		return w.kind === 'undo' ? setStatus(acc, w.choreId, 'none', null) : acc;
	}, groups);
}
