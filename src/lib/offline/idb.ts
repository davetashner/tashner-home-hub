import type { QueuedWrite, QueueStorage } from '#lib/domain/write-queue.js';

const DB = 'hub-offline';
const STORE = 'kv';
const KEY = 'write-queue';

function open(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB, 1);
		req.onupgradeneeded = () => req.result.createObjectStore(STORE);
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

async function run<T>(
	mode: IDBTransactionMode,
	fn: (s: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
	const db = await open();
	try {
		return await new Promise<T>((resolve, reject) => {
			const req = fn(db.transaction(STORE, mode).objectStore(STORE));
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
	} finally {
		db.close();
	}
}

/** The whole queue lives under one key: it is tiny and rewritten atomically. */
export const idbStorage: QueueStorage = {
	async load() {
		return ((await run('readonly', (s) => s.get(KEY))) as QueuedWrite[] | undefined) ?? [];
	},
	async save(items) {
		await run('readwrite', (s) => s.put(items, KEY));
	}
};
