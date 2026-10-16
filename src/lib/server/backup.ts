import { mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { Cron } from 'croner';
import { getDb } from './db/index.js';
import {
	DAY_MS,
	backupName,
	parseBackupName,
	selectBackupsToDelete
} from './domain/backup-retention.js';

export interface BackupResult {
	ok: boolean;
	at: number;
	file?: string;
	bytes?: number;
	pruned?: string[];
	error?: string;
}

export interface BackupInfo {
	file: string;
	bytes: number;
	at: number;
}

let lastResult: BackupResult | undefined;
let running: Promise<unknown> | undefined;

/** Resolves once any in-flight backup has finished (it never rejects). */
export const backupIdle = (): Promise<void> => (running ?? Promise.resolve()).then(() => undefined);

export function backupDir(dataDir = process.env.DATA_DIR ?? './data'): string {
	return join(dataDir, 'backups');
}

export function listBackups(dir = backupDir()): BackupInfo[] {
	try {
		return readdirSync(dir)
			.flatMap((file) => {
				const at = parseBackupName(file);
				return at === null ? [] : [{ file, at, bytes: statSync(join(dir, file)).size }];
			})
			.sort((a, b) => b.at - a.at);
	} catch {
		return [];
	}
}

export function backupStatus(): {
	enabled: boolean;
	last: BackupResult | null;
	backups: BackupInfo[];
} {
	return {
		enabled: process.env.HUB_BACKUPS !== 'off',
		last: lastResult ?? null,
		backups: listBackups()
	};
}

/**
 * Online backup via SQLite's backup API (safe with WAL), verified with
 * `integrity_check`, then retention applied. Never throws.
 */
export function runBackup(
	source: Database.Database = getDb().$client,
	dir = backupDir(),
	now = Date.now()
): Promise<BackupResult> {
	const p = doBackup(source, dir, now);
	running = p;
	void p.finally(() => {
		if (running === p) running = undefined;
	});
	return p;
}

async function doBackup(
	source: Database.Database = getDb().$client,
	dir = backupDir(),
	now = Date.now()
): Promise<BackupResult> {
	const file = backupName(now);
	const partial = join(dir, `${file}.partial`);
	let result: BackupResult;
	try {
		mkdirSync(dir, { recursive: true });
		await source.backup(partial);
		const copy = new Database(partial);
		try {
			// Make the copy a single self-contained file (no -wal/-shm sidecars).
			copy.pragma('journal_mode = DELETE');
			const check = copy.pragma('integrity_check', { simple: true });
			if (check !== 'ok') throw new Error(`integrity_check failed: ${String(check)}`);
		} finally {
			copy.close();
		}
		renameSync(partial, join(dir, file));
		const pruned = selectBackupsToDelete(readdirSync(dir), now);
		for (const p of pruned) rmSync(join(dir, p), { force: true });
		result = { ok: true, at: now, file, bytes: statSync(join(dir, file)).size, pruned };
	} catch (e) {
		try {
			rmSync(partial, { force: true });
		} catch {
			// best effort
		}
		result = { ok: false, at: now, error: e instanceof Error ? e.message : String(e) };
		console.error('[backup] failed:', result.error);
	}
	lastResult = result;
	return result;
}

/** Nightly 03:30 local-time backup, plus one at startup if the newest is over 24 h old. */
export function startBackupScheduler(): Cron | undefined {
	if (process.env.HUB_BACKUPS === 'off') return undefined;
	const newest = listBackups()[0];
	if (!newest || Date.now() - newest.at > DAY_MS) void runBackup();
	return new Cron('30 3 * * *', { protect: true }, () => void runBackup());
}
