/** Backup file naming and retention (NFR-7). Pure: no filesystem or clock access. */

export const DAY_MS = 24 * 60 * 60 * 1000;
export const RETENTION_DAYS = 30;
export const MIN_KEEP = 7;

const NAME_RE = /^hub-(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})Z\.db$/;

const pad = (n: number) => String(n).padStart(2, '0');

/** `hub-YYYY-MM-DDTHHmmZ.db` (UTC). */
export function backupName(at: number): string {
	const d = new Date(at);
	return `hub-${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}Z.db`;
}

/** Timestamp encoded in a backup file name, or null for unrelated files. */
export function parseBackupName(name: string): number | null {
	const m = NAME_RE.exec(name);
	if (!m) return null;
	const [y, mo, d, h, mi] = m.slice(1).map(Number);
	const t = Date.UTC(y, mo - 1, d, h, mi);
	return backupName(t) === name ? t : null;
}

/**
 * Which files to delete: keep everything from the last `days` days (future-dated
 * files count as recent), and always keep the `minKeep` newest regardless of age.
 * Names that are not backups are never returned.
 */
export function selectBackupsToDelete(
	names: string[],
	now: number,
	days = RETENTION_DAYS,
	minKeep = MIN_KEEP
): string[] {
	const backups = names
		.map((name) => ({ name, at: parseBackupName(name) }))
		.filter((b): b is { name: string; at: number } => b.at !== null)
		.sort((a, b) => b.at - a.at);
	const cutoff = now - days * DAY_MS;
	return backups.filter((b, i) => i >= minKeep && b.at < cutoff).map((b) => b.name);
}
