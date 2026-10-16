import { eq } from 'drizzle-orm';
import { schema, type Db } from '../db/index.js';
import { DEFAULT_TARGET, type Size } from '../domain/photo-fit.js';
import { getPhotoCache } from '../photo-cache/cache.js';

/** Targets to keep warm: landscape always; the portrait swap too when the display is set to portrait. */
export function prerenderTargets(db: Db): Size[] {
	const row = db
		.select()
		.from(schema.settings)
		.where(eq(schema.settings.key, 'display.orientation'))
		.get();
	let orientation: unknown = 'landscape';
	try {
		orientation = row ? JSON.parse(row.value) : 'landscape';
	} catch {
		// keep default
	}
	const portrait = { width: DEFAULT_TARGET.height, height: DEFAULT_TARGET.width };
	return orientation === 'portrait' ? [DEFAULT_TARGET, portrait] : [DEFAULT_TARGET];
}

const pending: string[] = [];
let draining: Promise<void> | undefined;

/**
 * Renders photos one at a time in the background (the cache queue also caps concurrency), so a
 * big first scan never starves on-demand requests for long. Failures are skipped.
 */
export function enqueuePrerender(db: Db, ids: string[]): void {
	pending.push(...ids);
	draining ??= (async () => {
		const cache = getPhotoCache();
		for (let id = pending.shift(); id !== undefined; id = pending.shift()) {
			for (const target of prerenderTargets(db))
				await cache.ensureRendered(id, target, ['avif']).catch(() => null);
		}
	})().finally(() => (draining = undefined));
}

export const prerenderIdle = (): Promise<void> => draining ?? Promise.resolve();

/** Shutdown: forget queued photos; the render in progress finishes on its own. */
export function dropPendingPrerenders(): void {
	pending.length = 0;
}
