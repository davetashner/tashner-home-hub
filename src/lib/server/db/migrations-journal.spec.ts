import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const drizzleDir = resolve(process.cwd(), 'drizzle');

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

	it('prefixes each tag with its zero-padded idx', () => {
		for (const e of entries) {
			expect(
				e.tag.startsWith(`${String(e.idx).padStart(4, '0')}_`),
				`tag ${e.tag} idx ${e.idx}`
			).toBe(true);
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
