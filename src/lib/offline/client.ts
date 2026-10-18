import { swEnabled } from '#lib/domain/offline-cache.js';
import {
	classifyStatus,
	WriteQueue,
	type DropReason,
	type NewWrite,
	type QueuedWrite,
	type WriteMethod
} from '#lib/domain/write-queue.js';
import { idbStorage } from './idb.js';
import { isOffline, offline } from './state.svelte.js';

const SEND_TIMEOUT_MS = 8_000;
const RETRY_EVERY_MS = 15_000;

let dropHandler: ((write: QueuedWrite, reason: DropReason) => void) | null = null;

export function onWriteDropped(fn: typeof dropHandler) {
	dropHandler = fn;
}

async function send(write: QueuedWrite) {
	try {
		const res = await post(write.url, write.body, write.key, write.method);
		return classifyStatus(res.status);
	} catch {
		return 'retry' as const;
	}
}

function post(
	url: string,
	body: unknown,
	key: string,
	method: WriteMethod = 'POST'
): Promise<Response> {
	return fetch(url, {
		method,
		headers: { 'content-type': 'application/json', 'idempotency-key': key },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(SEND_TIMEOUT_MS)
	});
}

export const writeQueue = new WriteQueue({
	storage: idbStorage,
	send,
	now: Date.now,
	newId: () => crypto.randomUUID(),
	onDrop: (write, reason) => dropHandler?.(write, reason),
	onChange: (size) => (offline.queued = size)
});

export async function flushQueue(force = false): Promise<void> {
	try {
		if ((await writeQueue.flush(force)) > 0) offline.synced += 1;
	} catch {
		// Storage trouble: the next tick tries again.
	}
}

export type Delivery<T> =
	| { sent: true; data: T }
	| { sent: false; queued: true }
	| { sent: false; queued: false; status: number };

/**
 * Sends a kid action. A network failure (or an already-waiting queue, to keep order) parks the
 * write in IndexedDB and reports `queued`; the caller keeps its optimistic UI.
 */
export async function deliver<T>(write: NewWrite): Promise<Delivery<T>> {
	try {
		if ((await writeQueue.size()) === 0) {
			const res = await post(write.url, write.body, crypto.randomUUID(), write.method);
			if (res.ok) return { sent: true, data: (await res.json()) as T };
			if (classifyStatus(res.status) !== 'retry')
				return { sent: false, queued: false, status: res.status };
		}
	} catch {
		// Offline or slow: fall through to the queue.
	}
	await writeQueue.enqueue(write);
	void flushQueue();
	return { sent: false, queued: true };
}

/** Wires the retry loop, connectivity events and the service worker; returns a teardown. */
export function startOffline(): () => void {
	offline.online = navigator.onLine;
	void writeQueue
		.size()
		.then((n) => (offline.queued = n))
		.catch(() => {});

	// Back online: one cheap read lets the worker see the network again and clear the badge.
	const ping = () =>
		void fetch('/api/approvals/count')
			.then((res) => {
				offline.online = true; // an answer arrived, whatever the browser's flag says
				offline.cached = res.headers.has('x-hub-cache');
			})
			.catch(() => {});
	const onOnline = () => {
		offline.online = true;
		void flushQueue(true);
		ping();
	};
	// While showing saved copies, keep checking so the badge clears soon after recovery.
	const timer = setInterval(() => isOffline() && ping(), 1_500);
	const retry = setInterval(() => void flushQueue(), RETRY_EVERY_MS);
	void flushQueue();
	const onOffline = () => (offline.online = false);
	const onMessage = (event: MessageEvent) => {
		const data = event.data as { type?: string; servedFromCache?: boolean } | undefined;
		if (data?.type === 'hub-cache-state') offline.cached = data.servedFromCache === true;
	};
	window.addEventListener('online', onOnline);
	window.addEventListener('offline', onOffline);

	const container = navigator.serviceWorker;
	container?.addEventListener('message', onMessage);
	// Headless automation (CI) runs without the worker; localStorage 'hub.sw' = on/off overrides.
	let override: string | null = null;
	try {
		override = localStorage.getItem('hub.sw');
	} catch {
		// Storage blocked: no override.
	}
	const enabled = swEnabled(navigator.userAgent, override);
	void container?.ready.then((reg) => {
		reg.active?.postMessage({ type: 'hub-sw-enable', enabled });
		reg.active?.postMessage({ type: 'hub-cache-state?' });
	});

	return () => {
		window.removeEventListener('online', onOnline);
		window.removeEventListener('offline', onOffline);
		container?.removeEventListener('message', onMessage);
		clearInterval(timer);
		clearInterval(retry);
	};
}
