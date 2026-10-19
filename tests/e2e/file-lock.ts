import { mkdirSync, rmSync, statSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './data-dir';

// Some state is household-wide on the shared e2e server (the sitter session, the vacation range),
// so the specs that touch it take turns through a named lock directory. The holder touches the lock
// every few seconds: a waiter only treats it as abandoned when the holder stopped touching it (it
// died), never because a slow test under full-suite load simply ran past a fixed age.
const STALE_MS = 30_000;
const BEAT_MS = 3_000;

/** Waits for the lock called `name`, holds it, and returns the function that releases it. */
export async function holdLock(name: string): Promise<() => void> {
	const lock = join(DATA_DIR, `.${name}-lock`);
	mkdirSync(DATA_DIR, { recursive: true });
	for (;;) {
		try {
			mkdirSync(lock);
			const beat = setInterval(() => {
				try {
					const now = new Date();
					utimesSync(lock, now, now);
				} catch {
					// lock already gone
				}
			}, BEAT_MS);
			return () => {
				clearInterval(beat);
				rmSync(lock, { recursive: true, force: true });
			};
		} catch {
			try {
				if (Date.now() - statSync(lock).mtimeMs > STALE_MS) rmSync(lock, { recursive: true });
			} catch {
				// released meanwhile
			}
			await new Promise((r) => setTimeout(r, 200));
		}
	}
}
