import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { eq, getTableColumns, is } from 'drizzle-orm';
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core';
import { runBackup } from './backup.js';
import { getDb, schema, type Db } from './db/index.js';
import {
	EXPORT_TABLES,
	buildExport,
	isLocalSetting,
	validateImport,
	type ExportDocument,
	type ImportSpec,
	type Migration,
	type Row,
	type TableRows
} from './domain/export.js';

type AnyTable = SQLiteTable;

/** SQL table name -> Drizzle table, for every table in schema.ts. */
export const APP_TABLES: Record<string, AnyTable> = Object.fromEntries(
	(Object.values(schema) as unknown[])
		.filter((t): t is AnyTable => is(t, SQLiteTable))
		.map((t) => [getTableConfig(t).name, t])
);

export function latestMigration(
	dir = process.env.MIGRATIONS_DIR ?? resolve(process.cwd(), 'drizzle')
): Migration {
	const journal = JSON.parse(readFileSync(join(dir, 'meta', '_journal.json'), 'utf8')) as {
		entries: Migration[];
	};
	const last = journal.entries.at(-1);
	if (!last) throw new Error('migration journal is empty');
	return { idx: last.idx, tag: last.tag };
}

export function importSpec(): ImportSpec {
	return {
		columns: Object.fromEntries(
			EXPORT_TABLES.map((t) => [t, Object.keys(getTableColumns(APP_TABLES[t]))])
		),
		migrationIdx: latestMigration().idx
	};
}

export function exportAll(db: Db = getDb(), now = new Date()): ExportDocument {
	const raw: TableRows = {};
	for (const t of EXPORT_TABLES) raw[t] = db.select().from(APP_TABLES[t]).all() as Row[];
	return buildExport(raw, latestMigration(), now);
}

/** Replaces every exported table in one transaction. Kept: sessions (stateless cookies + local epochs). */
export function replaceAll(db: Db, tables: TableRows): Record<string, number> {
	return db.transaction((tx) => {
		const sources = new Map<string, string | null>();
		for (const t of ['calendar_sources', 'photo_sources'] as const) {
			const table = APP_TABLES[t] as typeof schema.calendarSources;
			for (const r of tx.select().from(table).all()) sources.set(`${t}:${r.id}`, r.credentials);
		}
		for (const t of [...EXPORT_TABLES].reverse()) {
			if (t === 'settings') {
				for (const r of tx.select().from(schema.settings).all())
					if (!isLocalSetting(r.key))
						tx.delete(schema.settings).where(eq(schema.settings.key, r.key)).run();
			} else tx.delete(APP_TABLES[t]).run();
		}
		const counts: Record<string, number> = {};
		for (const t of EXPORT_TABLES) {
			counts[t] = tables[t].length;
			for (const row of tables[t]) {
				// A source that already exists here keeps its stored (encrypted) credentials.
				const kept = sources.get(`${t}:${String(row.id)}`);
				tx.insert(APP_TABLES[t])
					.values(kept ? { ...row, credentials: kept } : row)
					.run();
			}
		}
		return counts;
	});
}

export type ImportResult =
	| {
			ok: true;
			counts: Record<string, number>;
			backup: string;
			reconnect: ExportDocument['reconnect'];
	  }
	| { ok: false; status: number; error: string };

/** Validates, takes a safety backup, then replaces everything. Never throws. */
export async function importAll(input: unknown, db: Db = getDb()): Promise<ImportResult> {
	const check = validateImport(input, importSpec());
	if (!check.ok) return { ok: false, status: 422, error: check.error };
	const backup = await runBackup(db.$client);
	if (!backup.ok || !backup.file)
		return { ok: false, status: 500, error: 'Could not back up first, so nothing was changed.' };
	try {
		const counts = replaceAll(db, check.doc.tables);
		return { ok: true, counts, backup: backup.file, reconnect: check.doc.reconnect };
	} catch (e) {
		return {
			ok: false,
			status: 422,
			error: `Import failed and was rolled back: ${e instanceof Error ? e.message : String(e)}`
		};
	}
}
