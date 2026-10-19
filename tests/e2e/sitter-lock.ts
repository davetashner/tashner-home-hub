import { mkdirSync, rmSync, statSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './data-dir';

// The info card and the current sitter session are household-wide on a shared server, so the
// sitter specs take turns. The holder touches the lock every few seconds: a waiter only treats it
// as abandoned when the holder stopped touching it (it died), never because a slow test under
// full-suite load simply ran past a fixed age.
const LOCK = join(DATA_DIR, '.sitter-lock');
const STALE_MS = 30_000;
const BEAT_MS = 3_000;

export async function holdSitter(): Promise<() => void> {
	mkdirSync(DATA_DIR, { recursive: true });
	for (;;) {
		try {
			mkdirSync(LOCK);
			const beat = setInterval(() => {
				try {
					const now = new Date();
					utimesSync(LOCK, now, now);
				} catch {
					// lock already gone
				}
			}, BEAT_MS);
			return () => {
				clearInterval(beat);
				rmSync(LOCK, { recursive: true, force: true });
			};
		} catch {
			try {
				if (Date.now() - statSync(LOCK).mtimeMs > STALE_MS) rmSync(LOCK, { recursive: true });
			} catch {
				// released meanwhile
			}
			await new Promise((r) => setTimeout(r, 200));
		}
	}
}
