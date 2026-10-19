/**
 * Data export/import document rules (ADM-5). Pure: no database or filesystem access.
 *
 * What an export holds (and does not):
 * - Every app table below, in foreign-key order (parents first). Row keys are the Drizzle
 *   property names from `schema.ts`.
 * - NOT exported: `events` (a cache of calendar syncs; they refill after a sync),
 *   `routine_progress` (per-day state that resets each morning), session epochs, the weather cache, and photo files (only photo metadata rows travel).
 * - Secrets: calendar/photo-source `credentials` are encrypted with this server's key, so they
 *   are left out and the sources listed under `reconnect`. The ntfy token (settings row
 *   `notify.token`) is the same kind of blob, so it is dropped too and listed as
 *   "Notifications"; `notify.last` and `notify.goals` are server-local state and stay out.
 *   Member PIN hashes ARE exported
 *   (salted scrypt hashes, not PINs) so PINs keep working after a restore.
 */
export const EXPORT_FORMAT = 'tashner-home-hub';
export const EXPORT_VERSION = 1;

/** Foreign-key order: parents before children. Import deletes in reverse, inserts in this order. */
export const EXPORT_TABLES = [
	'members',
	'calendar_sources',
	'photo_sources',
	'photos',
	'chores',
	'chore_completions',
	'missed_judgments',
	'fun_unlocks',
	'rewards',
	'star_transactions',
	'allowance_transactions',
	'goals',
	'redemptions',
	'lists',
	'list_items',
	'meal_plan_entries',
	'saved_meals',
	'countdowns',
	'routines',
	'routine_steps',
	'settings'
] as const;

/**
 * App tables deliberately left out of exports: `events` is a calendar sync cache, and
 * `notes` are short-lived sticky notes, `saved_drawings` are large unfinished kid drawings (the nightly backup of the database keeps them), and `routine_progress` is per-day state that resets itself each morning,, `api_tokens` are
 * device credentials that stay on this server (re-create them after a restore), and `sitter_sessions`
 * (and their `sitter_checkins`) are one-evening handovers with PIN hashes.
 */
export const EXCLUDED_TABLES = [
	'events',
	'routine_progress',
	'api_tokens',
	'notes',
	'saved_drawings',
	'sitter_sessions',
	'sitter_checkins'
] as const;

/** Settings keys that stay local to this server: kept on import, never exported. */
export const LOCAL_SETTING_PREFIXES = [
	'session.epoch.',
	'weather.cache',
	'notify.last',
	'notify.goals',
	'timers.list'
] as const;

/**
 * Settings rows holding secrets encrypted with this server's key: dropped from exports (and from
 * imported files) and kept on import, like local settings. Each is listed under `reconnect`.
 */
export const SECRET_SETTING_KEYS = [
	{ key: 'notify.token', label: 'Notifications' },
	{ key: 'sitter.card', label: 'Sitter mode info card' }
] as const;

/** Columns blanked on export, per table. */
const SECRET_COLUMNS: Record<string, string[]> = {
	calendar_sources: ['credentials'],
	photo_sources: ['credentials']
};
/** Sources whose credentials were dropped are listed so the user knows what to reconnect. */
const SOURCE_TABLES = ['calendar_sources', 'photo_sources'];

export type Row = Record<string, unknown>;
export type TableRows = Record<string, Row[]>;
export interface Migration {
	idx: number;
	tag: string;
}
export interface Reconnect {
	table: string;
	id: string;
	label: string;
}
export interface ExportDocument {
	format: typeof EXPORT_FORMAT;
	version: typeof EXPORT_VERSION;
	schemaMigration: Migration;
	exportedAt: string;
	reconnect: Reconnect[];
	tables: TableRows;
}

export const isLocalSetting = (key: unknown): boolean =>
	typeof key === 'string' &&
	(LOCAL_SETTING_PREFIXES.some((p) => key.startsWith(p)) ||
		SECRET_SETTING_KEYS.some((k) => k.key === key));

/** Rows as they go into (or come out of) a document: secrets blanked, local settings dropped. */
export function scrubRows(table: string, rows: Row[]): Row[] {
	const secret = SECRET_COLUMNS[table] ?? [];
	return rows
		.filter((r) => table !== 'settings' || !isLocalSetting(r.key))
		.map((r) => {
			const copy = { ...r };
			for (const c of secret) if (c in copy) copy[c] = null;
			// Forces a fresh sync once the source is reconnected.
			if (table === 'calendar_sources' && 'lastSyncAt' in copy) copy.lastSyncAt = null;
			return copy;
		});
}

export function buildExport(raw: TableRows, migration: Migration, now: Date): ExportDocument {
	const tables: TableRows = {};
	const reconnect: Reconnect[] = [];
	for (const t of EXPORT_TABLES) {
		const rows = raw[t] ?? [];
		if (SOURCE_TABLES.includes(t)) {
			for (const r of rows)
				if (r.credentials)
					reconnect.push({ table: t, id: String(r.id), label: String(r.label ?? r.id) });
		}
		if (t === 'settings')
			for (const { key, label } of SECRET_SETTING_KEYS)
				if (rows.some((r) => r.key === key && r.value))
					reconnect.push({ table: 'settings', id: key, label });
		tables[t] = scrubRows(t, rows);
	}
	return {
		format: EXPORT_FORMAT,
		version: EXPORT_VERSION,
		schemaMigration: migration,
		exportedAt: now.toISOString(),
		reconnect,
		tables
	};
}

export const exportFilename = (now: Date): string =>
	`hub-export-${now.toISOString().slice(0, 10)}.json`;

export interface ImportSpec {
	/** Column (property) names per table, for every table in EXPORT_TABLES. */
	columns: Record<string, string[]>;
	/** Latest migration index this server has applied. */
	migrationIdx: number;
}
export type ImportCheck =
	{ ok: true; doc: ExportDocument; counts: Record<string, number> } | { ok: false; error: string };

const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);
const fail = (error: string): ImportCheck => ({ ok: false, error });

export function validateImport(input: unknown, spec: ImportSpec): ImportCheck {
	if (!isObject(input) || input.format !== EXPORT_FORMAT)
		return fail('This is not a Home Hub export file.');
	if (input.version !== EXPORT_VERSION)
		return fail(`Unsupported export version ${String(input.version)}.`);
	const mig = input.schemaMigration;
	if (!isObject(mig) || !Number.isInteger(mig.idx) || typeof mig.tag !== 'string')
		return fail('The export has no valid schemaMigration.');
	if ((mig.idx as number) > spec.migrationIdx)
		return fail('This export is from a newer Home Hub. Update this server first.');
	if (typeof input.exportedAt !== 'string' || Number.isNaN(Date.parse(input.exportedAt)))
		return fail('The export has no valid exportedAt date.');
	if (!isObject(input.tables)) return fail('The export has no tables.');

	const known: readonly string[] = EXPORT_TABLES;
	const unknown = Object.keys(input.tables).filter((t) => !known.includes(t));
	if (unknown.length) return fail(`Unknown tables: ${unknown.join(', ')}.`);
	const missing = EXPORT_TABLES.filter((t) => !(t in (input.tables as object)));
	if (missing.length) return fail(`Missing tables: ${missing.join(', ')}.`);

	const tables: TableRows = {};
	const counts: Record<string, number> = {};
	for (const t of EXPORT_TABLES) {
		const rows = (input.tables as Record<string, unknown>)[t];
		if (!Array.isArray(rows)) return fail(`Table ${t} must be a list of rows.`);
		const cols = spec.columns[t] ?? [];
		for (const [i, r] of rows.entries()) {
			if (!isObject(r)) return fail(`Table ${t}, row ${i + 1} is not an object.`);
			const bad = Object.keys(r).filter((k) => !cols.includes(k));
			if (bad.length)
				return fail(`Table ${t}, row ${i + 1} has unknown columns: ${bad.join(', ')}.`);
		}
		tables[t] = scrubRows(t, rows as Row[]);
		counts[t] = tables[t].length;
	}
	const doc: ExportDocument = {
		format: EXPORT_FORMAT,
		version: EXPORT_VERSION,
		schemaMigration: { idx: mig.idx as number, tag: mig.tag },
		exportedAt: input.exportedAt,
		reconnect: Array.isArray(input.reconnect) ? (input.reconnect as Reconnect[]) : [],
		tables
	};
	return { ok: true, doc, counts };
}
