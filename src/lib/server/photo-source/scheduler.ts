import { Cron } from 'croner';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { scanAndPrerender } from './service.js';

/**
 * Rescans every folder source every 15 minutes. HUB_PHOTO_SCAN=off disables it. No fs.watch:
 * recursive watching is unreliable on Linux and never sees changes on SMB/NFS or Docker bind
 * mounts, so a cheap stat walk on a timer (plus the Scan now button) is the dependable path.
 */
export function startPhotoScanner(env: NodeJS.ProcessEnv = process.env): Cron | undefined {
	if (env.HUB_PHOTO_SCAN === 'off') return undefined;
	const tickAll = () => {
		const db = getDb();
		const sources = db
			.select({ id: schema.photoSources.id })
			.from(schema.photoSources)
			.where(eq(schema.photoSources.kind, 'folder'))
			.all();
		for (const s of sources) void scanAndPrerender(db, s.id).catch(() => undefined);
	};
	tickAll();
	return new Cron('*/15 * * * *', { protect: true, catch: true }, tickAll);
}
