import { backupIdle } from './backup.js';
import { closeDb } from './db/index.js';
import { prerenderIdle, dropPendingPrerenders } from './photo-source/prerender.js';

type Stoppable = { stop: () => unknown } | undefined;

const jobs: Stoppable[] = [];
const GRACE_MS = 2_000;
let installed = false;
let stopping = false;

/** Registers a scheduler (croner job) so shutdown can stop it. */
export function trackJob(job: Stoppable): void {
	jobs.push(job);
}

/**
 * Stops background work, lets an in-flight backup or render finish (bounded by GRACE_MS), closes
 * SQLite and exits 0. A backup writes to `*.partial` and renames only after `integrity_check`, so
 * an interrupted one can never look valid. Idempotent.
 */
export async function shutdown(exit: (code: number) => void = process.exit): Promise<void> {
	if (stopping) return;
	stopping = true;
	for (const job of jobs) job?.stop();
	dropPendingPrerenders();
	const deadline = new Promise<void>((r) => setTimeout(r, GRACE_MS).unref());
	await Promise.race([Promise.all([backupIdle(), prerenderIdle()]), deadline]);
	try {
		closeDb();
	} catch (e) {
		console.error('[shutdown] closing the database failed:', e);
	}
	exit(0);
}

/**
 * adapter-node stops accepting connections on SIGTERM/SIGINT and waits for open ones (up to
 * SHUTDOWN_TIMEOUT, 30 s), then emits `sveltekit:shutdown`; it never exits by itself. We exit on
 * that event, and also GRACE_MS after the signal so a stuck long-lived connection cannot make
 * `docker stop` wait out its 10 s and SIGKILL mid-write.
 */
export function installShutdownHandlers(): void {
	if (installed) return;
	installed = true;
	process.on('sveltekit:shutdown', () => void shutdown());
	for (const sig of ['SIGTERM', 'SIGINT'] as const)
		process.on(sig, () => {
			setTimeout(() => void shutdown(), GRACE_MS).unref();
		});
}
