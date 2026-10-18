import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { photoSources } from '../db/schema.js';
import {
	GoogleError,
	authUrl,
	createPkce,
	exchangeCode,
	googleConfig
} from '../calendar/google.js';
import { localDateIn } from '../domain/chores.js';
import { parseConfig, safeJoin } from '../domain/photo-folder.js';
import {
	defaultAlbumName,
	importFileName,
	isImportable,
	parseDurationMs,
	sanitizeAlbumName
} from '../domain/photos-import.js';
import { householdTimeZone } from '../household.js';
import {
	PICKER_SCOPE,
	createSession,
	deleteSession,
	downloadBytes,
	getSession,
	listPicked
} from './google-picker.js';
import { validateRoot } from './paths.js';
import { scanAndPrerender } from './service.js';

const PENDING_TTL_MS = 15 * 60_000;
const DEFAULT_POLL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 30 * 60_000;
const MAX_FILE_BYTES = 100 * 1024 * 1024;

const pending = new Map<string, { verifier: string; expires: number }>();
let token: { accessToken: string; expiresAt: number } | null = null;

/** Begins a consent for the picker scope; open the URL on any device. */
export function startPickerConsent(now = Date.now()): { url: string; state: string } {
	const cfg = googleConfig();
	for (const [k, v] of pending) if (v.expires < now) pending.delete(k);
	if (pending.size >= 20) pending.delete(pending.keys().next().value!);
	const state = randomBytes(18).toString('base64url');
	const { verifier, challenge } = createPkce();
	pending.set(state, { verifier, expires: now + PENDING_TTL_MS });
	return { url: authUrl(cfg, state, challenge, PICKER_SCOPE), state };
}

/** Exchanges the pasted address for an access token, kept in memory only (a pick is one-off). */
export async function finishPickerConsent(code: string, state: string): Promise<void> {
	const entry = pending.get(state);
	if (!entry || entry.expires < Date.now())
		throw new GoogleError('That sign-in attempt expired or was not started here. Start again');
	pending.delete(state);
	const t = await exchangeCode(googleConfig(), code, entry.verifier);
	token = { accessToken: t.accessToken, expiresAt: t.expiresAt };
}

export function isConnected(now = Date.now()): boolean {
	return !!token && token.expiresAt - 60_000 > now;
}

export type ImportStatus = 'waiting' | 'importing' | 'done' | 'error' | 'cancelled';

export interface ImportView {
	id: string;
	status: ImportStatus;
	album: string;
	pickerUri: string;
	total: number;
	done: number;
	skipped: number;
	failed: number;
	message?: string;
}

interface Job extends ImportView {
	cancelled: boolean;
	promise: Promise<void>;
}

let current: Job | null = null;
const view = ({ cancelled: _c, promise: _p, ...v }: Job): ImportView => v;

export function currentImport(): ImportView | null {
	return current ? view(current) : null;
}

export function cancelImport(): void {
	if (current && (current.status === 'waiting' || current.status === 'importing'))
		current.cancelled = true;
}

export interface ImportOptions {
	sourceId: string;
	album?: unknown;
	sleep?: (ms: number) => Promise<void>;
	now?: () => number;
}

/** Creates a picker session and starts importing in the background. One import at a time. */
export async function startImport(db: Db, opts: ImportOptions): Promise<ImportView> {
	if (current && (current.status === 'waiting' || current.status === 'importing'))
		throw new GoogleError('An import is already running');
	if (!token || !isConnected()) throw new GoogleError('Connect Google first', true);
	const row = db.select().from(photoSources).where(eq(photoSources.id, opts.sourceId)).get();
	if (!row || row.kind !== 'folder') throw new GoogleError('Unknown photo folder');
	const root = await validateRoot(parseConfig(row.config).root).catch(() => {
		throw new GoogleError('That photo folder is not available');
	});
	const album = sanitizeAlbumName(
		opts.album,
		defaultAlbumName(localDateIn(Date.now(), householdTimeZone(db)))
	);
	const dir = safeJoin(root, album);
	if (!dir) throw new GoogleError('That album name is not allowed');

	const accessToken = token.accessToken;
	const session = await createSession(accessToken);
	const job: Job = {
		id: randomUUID(),
		status: 'waiting',
		album,
		pickerUri: session.pickerUri,
		total: 0,
		done: 0,
		skipped: 0,
		failed: 0,
		cancelled: false,
		promise: Promise.resolve()
	};
	current = job;
	job.promise = run(db, job, { accessToken, session, dir, sourceId: row.id, opts }).catch((e) => {
		job.status = 'error';
		job.message = e instanceof GoogleError ? e.message : 'The import failed';
	});
	return view(job);
}

/** Resolves when the running import (if any) has finished; for tests. */
export async function settled(): Promise<void> {
	await current?.promise;
}

async function exists(path: string): Promise<boolean> {
	return stat(path).then(
		(s) => s.isFile() && s.size > 0,
		() => false
	);
}

async function run(
	db: Db,
	job: Job,
	ctx: {
		accessToken: string;
		session: Awaited<ReturnType<typeof createSession>>;
		dir: string;
		sourceId: string;
		opts: ImportOptions;
	}
): Promise<void> {
	const { accessToken, session, dir, opts } = ctx;
	const sleep = opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
	const now = opts.now ?? Date.now;
	try {
		const interval = parseDurationMs(session.pollingConfig?.pollInterval, DEFAULT_POLL_MS);
		const deadline = now() + timeoutMs(session.pollingConfig?.timeoutIn);
		let set = !!session.mediaItemsSet;
		while (!set) {
			if (job.cancelled) {
				job.status = 'cancelled';
				return;
			}
			if (now() > deadline) throw new GoogleError('Nothing was picked in time. Start again');
			await sleep(interval);
			const s = await getSession(accessToken, session.id);
			set = !!s.mediaItemsSet;
		}
		job.status = 'importing';
		const items = (await listPicked(accessToken, session.id)).filter(isImportable);
		job.total = items.length;
		await mkdir(dir, { recursive: true });
		for (const item of items) {
			if (job.cancelled) {
				job.status = 'cancelled';
				return;
			}
			const file = safeJoin(dir, importFileName(item));
			if (!file) {
				job.failed++;
				continue;
			}
			try {
				if (await exists(file)) job.skipped++;
				else {
					const bytes = await downloadBytes(accessToken, item.mediaFile!.baseUrl!);
					if (bytes.length === 0 || bytes.length > MAX_FILE_BYTES) throw new Error('bad size');
					const part = `${dirname(file)}/.part-${randomUUID()}`;
					await writeFile(part, bytes);
					await rename(part, file).catch(async (e) => {
						await rm(part, { force: true });
						throw e;
					});
					job.done++;
				}
			} catch (e) {
				if (e instanceof GoogleError && e.needsReauth) throw e;
				job.failed++;
			}
		}
		await scanAndPrerender(db, ctx.sourceId);
		job.status = 'done';
		if (job.failed)
			job.message = `${job.failed} photo(s) could not be downloaded. Run it again to retry`;
	} finally {
		await deleteSession(accessToken, session.id);
	}
}

function timeoutMs(text: unknown): number {
	const m = typeof text === 'string' ? /^(\d+(?:\.\d+)?)s$/.exec(text) : null;
	return m ? Number(m[1]) * 1000 : DEFAULT_TIMEOUT_MS;
}

/** Test hook: forget tokens, pending consents and the last job. */
export function resetForTests(): void {
	token = null;
	pending.clear();
	current = null;
}

/** Test hook: install a token without going through Google. */
export function setTokenForTests(accessToken: string, expiresAt = Date.now() + 3_600_000): void {
	token = { accessToken, expiresAt };
}
