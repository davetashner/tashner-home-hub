import { describe, expect, it } from 'vitest';
import {
	EXPORT_TABLES,
	buildExport,
	exportFilename,
	isLocalSetting,
	scrubRows,
	validateImport,
	type ExportDocument,
	type ImportSpec,
	type TableRows
} from './export.js';

const spec: ImportSpec = {
	columns: Object.fromEntries(
		EXPORT_TABLES.map((t) => [t, ['id', 'key', 'value', 'label', 'credentials', 'lastSyncAt']])
	),
	migrationIdx: 3
};
const empty = (): TableRows => Object.fromEntries(EXPORT_TABLES.map((t) => [t, []]));
const now = new Date('2026-10-17T12:00:00Z');
const doc = (raw: TableRows = empty()): ExportDocument =>
	buildExport(raw, { idx: 0, tag: '0000_x' }, now);

describe('buildExport', () => {
	it('has the documented shape and lists sources needing reconnection', () => {
		const raw = empty();
		raw.calendar_sources = [{ id: 'c1', label: 'Family', credentials: 'enc', lastSyncAt: 5 }];
		raw.photo_sources = [{ id: 'p1', label: 'Folder', credentials: null }];
		const d = doc(raw);
		expect(d).toEqual({
			format: 'tashner-home-hub',
			version: 1,
			schemaMigration: { idx: 0, tag: '0000_x' },
			exportedAt: '2026-10-17T12:00:00.000Z',
			reconnect: [{ table: 'calendar_sources', id: 'c1', label: 'Family' }],
			tables: {
				...empty(),
				calendar_sources: [{ id: 'c1', label: 'Family', credentials: null, lastSyncAt: null }],
				photo_sources: [{ id: 'p1', label: 'Folder', credentials: null }]
			}
		});
	});

	it('tolerates missing tables and labels by id as a fallback', () => {
		const d = buildExport(
			{ photo_sources: [{ id: 'p', credentials: 'x' }] },
			{ idx: 0, tag: 't' },
			now
		);
		expect(d.reconnect).toEqual([{ table: 'photo_sources', id: 'p', label: 'p' }]);
		expect(d.tables.members).toEqual([]);
	});

	it('names the file by date', () => {
		expect(exportFilename(now)).toBe('hub-export-2026-10-17.json');
	});
});

describe('scrubRows', () => {
	it('drops local settings only', () => {
		const rows = [
			{ key: 'session.epoch.a', value: '1' },
			{ key: 'weather.cache', value: '{}' },
			{ key: 'weather.location', value: '{}' }
		];
		expect(scrubRows('settings', rows)).toEqual([{ key: 'weather.location', value: '{}' }]);
		expect(isLocalSetting(4)).toBe(false);
	});
});

describe('ntfy settings', () => {
	it('keeps the token out of an export and lists it for reconnecting', () => {
		const raw = empty();
		raw.settings = [
			{ key: 'notify.config', value: '{"topic":"t"}' },
			{ key: 'notify.token', value: 'enc-token-blob' },
			{ key: 'notify.last', value: '1' },
			{ key: 'notify.goals', value: '["g"]' }
		];
		const d = doc(raw);
		expect(d.tables.settings).toEqual([{ key: 'notify.config', value: '{"topic":"t"}' }]);
		expect(JSON.stringify(d)).not.toContain('enc-token-blob');
		expect(d.reconnect).toEqual([
			{ table: 'settings', id: 'notify.token', label: 'Notifications' }
		]);
		expect(doc().reconnect).toEqual([]);
	});
});

describe('validateImport', () => {
	const good = () => JSON.parse(JSON.stringify(doc())) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
	const err = (input: unknown) => {
		const r = validateImport(input, spec);
		return r.ok ? '' : r.error;
	};

	it('accepts a clean export and counts rows', () => {
		const d = good();
		d.tables.lists = [{ id: 'l1' }];
		const r = validateImport(d, spec);
		expect(r.ok && r.counts.lists).toBe(1);
		expect(r.ok && r.counts.members).toBe(0);
	});

	it('accepts an older schema and strips local settings', () => {
		const d = good();
		d.tables.settings = [
			{ key: 'session.epoch.x', value: '1' },
			{ key: 'a', value: '2' }
		];
		const r = validateImport(d, spec);
		expect(r.ok && r.doc.tables.settings).toEqual([{ key: 'a', value: '2' }]);
		expect(r.ok && r.doc.reconnect).toEqual([]);
	});

	it('keeps a reconnect list when present', () => {
		const d = good();
		d.reconnect = [{ table: 'calendar_sources', id: 'c', label: 'L' }];
		const r = validateImport(d, spec);
		expect(r.ok && r.doc.reconnect).toHaveLength(1);
	});

	it.each([
		['not an object', 'x', 'not a Home Hub export'],
		['wrong format', { ...good(), format: 'other' }, 'not a Home Hub export'],
		['wrong version', { ...good(), version: 2 }, 'Unsupported export version 2'],
		['no migration', { ...good(), schemaMigration: null }, 'schemaMigration'],
		[
			'bad migration idx',
			{ ...good(), schemaMigration: { idx: 1.5, tag: 't' } },
			'schemaMigration'
		],
		['newer schema', { ...good(), schemaMigration: { idx: 4, tag: 't' } }, 'newer Home Hub'],
		['bad date', { ...good(), exportedAt: 'nope' }, 'exportedAt'],
		['no tables', { ...good(), tables: [] }, 'no tables']
	])('refuses %s', (_n, input, text) => {
		expect(err(input)).toContain(text);
	});

	it('refuses unknown and missing tables, bad rows and unknown columns', () => {
		let d = good();
		d.tables.events = [];
		expect(err(d)).toBe('Unknown tables: events.');
		d = good();
		delete d.tables.lists;
		expect(err(d)).toBe('Missing tables: lists.');
		d = good();
		d.tables.lists = {};
		expect(err(d)).toContain('must be a list');
		d = good();
		d.tables.lists = [1];
		expect(err(d)).toContain('row 1 is not an object');
		d = good();
		d.tables.lists = [{ id: 'a', bogus: 1 }];
		expect(err(d)).toBe('Table lists, row 1 has unknown columns: bogus.');
	});
});
