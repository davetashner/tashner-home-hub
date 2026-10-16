import { mkdtempSync, rmSync, writeFileSync, chmodSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listBackups, runBackup } from './backup.js';
import { backupName } from './domain/backup-retention.js';

let root: string;
let src: Database.Database;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'hub-backup-'));
	src = new Database(join(root, 'hub.db'));
	src.pragma('journal_mode = WAL');
	src.exec('CREATE TABLE stars (id INTEGER PRIMARY KEY, n INTEGER)');
	src.exec('INSERT INTO stars (n) VALUES (1), (2), (3)');
});
afterEach(() => {
	src.close();
	rmSync(root, { recursive: true, force: true });
});

describe('runBackup', () => {
	it('writes a verified copy containing the rows and leaves no partial file', async () => {
		const dir = join(root, 'backups');
		const now = Date.UTC(2026, 9, 15, 3, 30);
		const res = await runBackup(src, dir, now);
		expect(res).toMatchObject({ ok: true, file: backupName(now) });
		expect(readdirSync(dir)).toEqual([backupName(now)]);
		const copy = new Database(join(dir, backupName(now)), { readonly: true });
		expect(copy.pragma('integrity_check', { simple: true })).toBe('ok');
		expect(copy.prepare('SELECT sum(n) AS s FROM stars').get()).toEqual({ s: 6 });
		copy.close();
		expect(listBackups(dir)).toHaveLength(1);
	});

	it('prunes old backups beyond retention', async () => {
		const dir = join(root, 'backups');
		const now = Date.UTC(2026, 9, 15, 3, 30);
		const old = now - 100 * 86400000;
		await runBackup(src, dir, old);
		for (let i = 1; i <= 7; i++) await runBackup(src, dir, now - i * 86400000);
		const res = await runBackup(src, dir, now);
		expect(res.ok).toBe(true);
		const files = listBackups(dir);
		expect(files).toHaveLength(8);
		expect(files.map((f) => f.at)).not.toContain(old);
	});

	it('returns an error result instead of throwing when the directory is unwritable', async () => {
		const blocker = join(root, 'blocked');
		writeFileSync(blocker, 'a file where a directory should be');
		const res = await runBackup(src, join(blocker, 'backups'));
		expect(res.ok).toBe(false);
		expect(res.error).toBeTruthy();
		chmodSync(blocker, 0o600);
	});
});
