import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const drizzleDir = resolve(process.cwd(), 'drizzle');

/** Last migration generated with the old index prefix; everything after uses a timestamp. */
const LAST_LEGACY_IDX = 9;

type Entry = { idx: number; when: number; tag: string };

const entries: Entry[] = (
	JSON.parse(readFileSync(resolve(drizzleDir, 'meta/_journal.json'), 'utf8')) as {
		entries: Entry[];
	}
).entries;

describe('drizzle migration journal', () => {
	it('has strictly increasing "when" timestamps', () => {
		for (let i = 1; i < entries.length; i++) {
			const prev = entries[i - 1];
			const cur = entries[i];
			expect(
				cur.when,
				`Journal entry ${cur.tag} has when=${cur.when}, not above ${prev.tag} (when=${prev.when}). ` +
					`Drizzle's migrator skips any migration whose timestamp is not newer than the last ` +
					`applied one, so it would silently never run on an existing DB. ` +
					`Fix: edit drizzle/meta/_journal.json and set ${cur.tag}'s "when" above ${prev.when}.`
			).toBeGreaterThan(prev.when);
		}
	});

	it('has idx running 0..n-1 in order', () => {
		expect(entries.map((e) => e.idx)).toEqual(entries.map((_, i) => i));
	});

	it('prefixes legacy tags with their zero-padded idx and later tags with a 14-digit timestamp', () => {
		// 0000-0009 predate `migrations.prefix: 'timestamp'` in drizzle.config.ts. New entries are
		// named YYYYMMDDHHMMSS_name so concurrent branches never collide on a number.
		for (const e of entries) {
			if (e.idx <= LAST_LEGACY_IDX) {
				expect(
					/^\d{4}_/.test(e.tag) && e.tag.startsWith(`${String(e.idx).padStart(4, '0')}_`),
					`legacy tag ${e.tag} must start with ${String(e.idx).padStart(4, '0')}_`
				).toBe(true);
			} else {
				expect(
					/^\d{14}_/.test(e.tag),
					`tag ${e.tag} (idx ${e.idx}) must start with a 14-digit timestamp (drizzle.config.ts uses prefix 'timestamp')`
				).toBe(true);
			}
		}
	});

	it('has a .sql file for each tag', () => {
		for (const e of entries) {
			expect(existsSync(resolve(drizzleDir, `${e.tag}.sql`)), `missing drizzle/${e.tag}.sql`).toBe(
				true
			);
		}
	});
});
