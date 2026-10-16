import { describe, expect, it } from 'vitest';
import { DAY_MS, backupName, parseBackupName, selectBackupsToDelete } from './backup-retention.js';

const NOW = Date.UTC(2026, 9, 15, 3, 30);
const ago = (days: number) => backupName(NOW - days * DAY_MS);

describe('backup names', () => {
	it('round-trips', () => {
		expect(backupName(NOW)).toBe('hub-2026-10-15T0330Z.db');
		expect(parseBackupName('hub-2026-10-15T0330Z.db')).toBe(NOW);
	});
	it('rejects unrelated or invalid names', () => {
		for (const n of [
			'hub.db',
			'hub.db-wal',
			'notes.txt',
			'hub-2026-13-40T2599Z.db',
			'hub-2026-10-15T0330Z.db.partial'
		])
			expect(parseBackupName(n)).toBeNull();
	});
});

describe('selectBackupsToDelete', () => {
	it('deletes nothing when there are fewer than 7, however old', () => {
		const names = [ago(100), ago(200), ago(300)];
		expect(selectBackupsToDelete(names, NOW)).toEqual([]);
	});
	it('keeps the 7 newest even when all are older than 30 days', () => {
		const names = Array.from({ length: 10 }, (_, i) => ago(40 + i));
		const del = selectBackupsToDelete(names, NOW);
		expect(del).toHaveLength(3);
		expect(del).toEqual([ago(47), ago(48), ago(49)]);
	});
	it('keeps exactly-30-day-old files and deletes older ones', () => {
		const recent = Array.from({ length: 7 }, (_, i) => ago(i));
		const del = selectBackupsToDelete([...recent, ago(30), ago(30.01)], NOW);
		expect(del).toEqual([ago(30.01)]);
	});
	it('keeps everything within 30 days even beyond 7 files', () => {
		const names = Array.from({ length: 30 }, (_, i) => ago(i));
		expect(selectBackupsToDelete(names, NOW)).toEqual([]);
	});
	it('treats future-dated files as recent and keeps them', () => {
		const names = [ago(-5), ago(-400), ...Array.from({ length: 8 }, (_, i) => ago(31 + i))];
		const del = selectBackupsToDelete(names, NOW);
		expect(del).not.toContain(ago(-5));
		expect(del).not.toContain(ago(-400));
		expect(del).toHaveLength(3);
	});
	it('ignores unrelated files', () => {
		const names = [
			'hub.db',
			'README.txt',
			'hub-2020-01-01T0000Z.db.partial',
			...Array.from({ length: 8 }, (_, i) => ago(60 + i))
		];
		const del = selectBackupsToDelete(names, NOW);
		expect(del).toEqual([ago(67)]);
	});
});
