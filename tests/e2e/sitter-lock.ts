import { mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './data-dir';

// The info card and the current sitter session are household-wide on a shared server, so the
// sitter specs take turns.
const LOCK = join(DATA_DIR, '.sitter-lock');

export async function holdSitter(): Promise<() => void> {
	mkdirSync(DATA_DIR, { recursive: true });
	for (;;) {
		try {
			mkdirSync(LOCK);
			return () => rmSync(LOCK, { recursive: true, force: true });
		} catch {
			try {
				if (Date.now() - statSync(LOCK).mtimeMs > 90_000) rmSync(LOCK, { recursive: true });
			} catch {
				// released meanwhile
			}
			await new Promise((r) => setTimeout(r, 200));
		}
	}
}
