import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { rebaseMigration, sqlHandEdits } from './rebase-migration.mjs';

const silent = () => {};

function sh(cwd, ...args) {
	return execFileSync('git', args, { cwd, encoding: 'utf8' });
}
function put(cwd, rel, text) {
	mkdirSync(dirname(join(cwd, rel)), { recursive: true });
	writeFileSync(join(cwd, rel), text);
}
function journal(tags) {
	return `${JSON.stringify(
		{
			version: '7',
			dialect: 'sqlite',
			entries: tags.map((tag, idx) => ({
				idx,
				version: '6',
				when: 1000 + idx * 1000,
				tag,
				breakpoints: true
			}))
		},
		null,
		'\t'
	)}\n`;
}
const spec = (n) => `expect(tables).toHaveLength(${n});\n`;

function addMigration(cwd, tags, tag, sql, count) {
	put(cwd, `drizzle/${tag}.sql`, sql);
	put(cwd, `drizzle/meta/${tag.slice(0, 4)}_snapshot.json`, `{"id":"${tag}"}\n`);
	put(cwd, 'drizzle/meta/_journal.json', journal(tags));
	put(cwd, 'src/lib/server/db/db.spec.ts', spec(count));
}

function fixture() {
	const cwd = mkdtempSync(join(tmpdir(), 'rebase-mig-'));
	sh(cwd, 'init', '-q', '-b', 'main');
	sh(cwd, 'config', 'user.email', 't@example.com');
	sh(cwd, 'config', 'user.name', 'T');
	addMigration(cwd, ['0000_init'], '0000_init', 'create table a(id);\n', 1);
	sh(cwd, 'add', '-A');
	sh(cwd, 'commit', '-q', '-m', 'base');
	return cwd;
}

/** Fake drizzle-kit: writes the next-numbered files and appends a journal entry. */
function fakeKit(calls) {
	return (name, cwd) => {
		calls.push(name);
		const j = JSON.parse(readFileSync(join(cwd, 'drizzle/meta/_journal.json'), 'utf8'));
		const idx = j.entries.length;
		const tag = `${String(idx).padStart(4, '0')}_${name}`;
		j.entries.push({ idx, version: '6', when: 5, tag, breakpoints: true });
		writeFileSync(join(cwd, 'drizzle/meta/_journal.json'), JSON.stringify(j));
		writeFileSync(join(cwd, `drizzle/${tag}.sql`), 'CREATE TABLE `b` (id);\n');
		writeFileSync(join(cwd, `drizzle/meta/${String(idx).padStart(4, '0')}_snapshot.json`), '{}');
	};
}

test('renumbers a colliding migration, bumps table count, sets when', () => {
	const cwd = fixture();
	sh(cwd, 'checkout', '-q', '-b', 'feat');
	addMigration(
		cwd,
		['0000_init', '0001_feat_thing'],
		'0001_feat_thing',
		'CREATE TABLE `b` (id REFERENCES a(id) ON DELETE set null);\n',
		2
	);
	sh(cwd, 'add', '-A');
	sh(cwd, 'commit', '-q', '-m', 'feat');
	sh(cwd, 'checkout', '-q', 'main');
	addMigration(cwd, ['0000_init', '0001_other'], '0001_other', 'create table c(id);\n', 2);
	sh(cwd, 'add', '-A');
	sh(cwd, 'commit', '-q', '-m', 'other');
	sh(cwd, 'checkout', '-q', 'feat');

	const calls = [];
	const res = rebaseMigration({
		cwd,
		base: 'main',
		fetch: false,
		drizzleKit: fakeKit(calls),
		prettier: () => {},
		now: () => 1_800_000_000_000,
		log: silent
	});
	assert.deepEqual(calls, ['feat_thing']);
	assert.equal(res.migrations[0].newTag, '0002_feat_thing');
	assert.ok(res.migrations[0].onlyInOld.some((l) => l.includes('ON DELETE set null')));
	const j = JSON.parse(readFileSync(join(cwd, 'drizzle/meta/_journal.json'), 'utf8'));
	assert.deepEqual(
		j.entries.map((e) => e.tag),
		['0000_init', '0001_other', '0002_feat_thing']
	);
	assert.equal(j.entries[2].when, 1_800_000_000_000);
	assert.match(readFileSync(join(cwd, 'src/lib/server/db/db.spec.ts'), 'utf8'), /\(3\)/);
	assert.equal(sh(cwd, 'status', '--porcelain').trim(), '');
	assert.equal(sh(cwd, 'log', '--format=%s', 'main..feat').trim(), 'feat');
	assert.throws(() => readFileSync(join(cwd, 'drizzle/0001_feat_thing.sql')));
});

test('plain rebase when the branch has no migration', () => {
	const cwd = fixture();
	sh(cwd, 'checkout', '-q', '-b', 'feat');
	put(cwd, 'a.txt', 'a\n');
	sh(cwd, 'add', '-A');
	sh(cwd, 'commit', '-q', '-m', 'feat');
	sh(cwd, 'checkout', '-q', 'main');
	put(cwd, 'b.txt', 'b\n');
	sh(cwd, 'add', '-A');
	sh(cwd, 'commit', '-q', '-m', 'main moves');
	sh(cwd, 'checkout', '-q', 'feat');
	const calls = [];
	const res = rebaseMigration({
		cwd,
		base: 'main',
		fetch: false,
		drizzleKit: fakeKit(calls),
		prettier: () => {},
		log: silent
	});
	assert.equal(res.rebased, true);
	assert.deepEqual(calls, []);
	assert.equal(sh(cwd, 'rev-list', '--count', 'main..feat').trim(), '1');
});

test('refuses a dirty tree', () => {
	const cwd = fixture();
	put(cwd, 'drizzle/0000_init.sql', 'changed\n');
	assert.throws(
		() => rebaseMigration({ cwd, base: 'main', fetch: false, log: silent }),
		/uncommitted/
	);
});

test('sqlHandEdits reports lines missing from the regenerated sql', () => {
	const e = sqlHandEdits('a;\n--> statement-breakpoint\nb ON DELETE set null;', 'a;\nb;');
	assert.deepEqual(e.onlyInOld, ['b ON DELETE set null;']);
	assert.deepEqual(e.onlyInNew, ['b;']);
});

test('handles timestamp-prefixed tags', () => {
	const cwd = mkdtempSync(join(tmpdir(), 'rebase-mig-ts-'));
	sh(cwd, 'init', '-q', '-b', 'main');
	sh(cwd, 'config', 'user.email', 't@example.com');
	sh(cwd, 'config', 'user.name', 'T');
	const add = (tags, tag) => {
		put(cwd, `drizzle/${tag}.sql`, `create table "${tag}"(id);\n`);
		put(cwd, `drizzle/meta/${tag.split('_')[0]}_snapshot.json`, `{"id":"${tag}"}\n`);
		put(cwd, 'drizzle/meta/_journal.json', journal(tags));
	};
	const commit = (m) => {
		sh(cwd, 'add', '-A');
		sh(cwd, 'commit', '-q', '-m', m);
	};
	add(['20260101000000_init'], '20260101000000_init');
	commit('base');
	sh(cwd, 'checkout', '-q', '-b', 'feat');
	add(['20260101000000_init', '20260102000000_feat_thing'], '20260102000000_feat_thing');
	commit('feat');
	sh(cwd, 'checkout', '-q', 'main');
	add(['20260101000000_init', '20260103000000_other'], '20260103000000_other');
	commit('other');
	sh(cwd, 'checkout', '-q', 'feat');
	const res = rebaseMigration({
		cwd,
		base: 'main',
		fetch: false,
		drizzleKit: (name, dir) => {
			const tag = `20260104000000_${name}`;
			const j = JSON.parse(readFileSync(join(dir, 'drizzle/meta/_journal.json'), 'utf8'));
			j.entries.push({ idx: j.entries.length, version: '6', when: 1, tag, breakpoints: true });
			writeFileSync(join(dir, 'drizzle/meta/_journal.json'), JSON.stringify(j));
			writeFileSync(join(dir, `drizzle/${tag}.sql`), 'x;\n');
			writeFileSync(join(dir, 'drizzle/meta/20260104000000_snapshot.json'), '{}');
		},
		prettier: () => {},
		now: () => 5000,
		log: silent
	});
	assert.equal(res.migrations[0].newTag, '20260104000000_feat_thing');
	assert.equal(sh(cwd, 'status', '--porcelain').trim(), '');
	assert.throws(() => readFileSync(join(cwd, 'drizzle/meta/20260102000000_snapshot.json')));
	const j = JSON.parse(readFileSync(join(cwd, 'drizzle/meta/_journal.json'), 'utf8'));
	assert.equal(j.entries[2].when, 5000);
});

test('collapses an add-then-rename pair of branch commits into one regenerated migration', () => {
	const cwd = mkdtempSync(join(tmpdir(), 'rebase-mig-two-'));
	sh(cwd, 'init', '-q', '-b', 'main');
	sh(cwd, 'config', 'user.email', 't@example.com');
	sh(cwd, 'config', 'user.name', 'T');
	const commit = (m) => {
		sh(cwd, 'add', '-A');
		sh(cwd, 'commit', '-q', '-m', m);
	};
	const snapOf = (tag) => `drizzle/meta/${tag.split('_')[0]}_snapshot.json`;
	const setMig = (tags, tag, sql) => {
		put(cwd, `drizzle/${tag}.sql`, sql);
		put(cwd, snapOf(tag), `{"id":"${tag}"}\n`);
		put(cwd, 'drizzle/meta/_journal.json', journal(tags));
	};
	setMig(['0000_init'], '0000_init', 'create table a(id);\n');
	commit('base');

	sh(cwd, 'checkout', '-q', '-b', 'feat');
	setMig(
		['0000_init', '0001_live_photo_motion'],
		'0001_live_photo_motion',
		'create table m(id);\n'
	);
	commit('feat: add');
	sh(cwd, 'rm', '-q', 'drizzle/0001_live_photo_motion.sql', 'drizzle/meta/0001_snapshot.json');
	setMig(
		['0000_init', '20261018185317_live_photo_motion'],
		'20261018185317_live_photo_motion',
		'create table m(id);\n'
	);
	commit('feat: rename to timestamp');

	sh(cwd, 'checkout', '-q', 'main');
	setMig(['0000_init', '0001_other'], '0001_other', 'create table c(id);\n');
	commit('main: other');
	sh(cwd, 'checkout', '-q', 'feat');

	const calls = [];
	const res = rebaseMigration({
		cwd,
		base: 'main',
		fetch: false,
		drizzleKit: (name, dir) => {
			calls.push(name);
			const tag = `20261019000000_${name}`;
			const j = JSON.parse(readFileSync(join(dir, 'drizzle/meta/_journal.json'), 'utf8'));
			j.entries.push({ idx: j.entries.length, version: '6', when: 1, tag, breakpoints: true });
			writeFileSync(join(dir, 'drizzle/meta/_journal.json'), JSON.stringify(j));
			writeFileSync(join(dir, `drizzle/${tag}.sql`), 'create table m(id);\n');
			writeFileSync(join(dir, 'drizzle/meta/20261019000000_snapshot.json'), '{}');
		},
		prettier: () => {},
		now: () => 1_900_000_000_000,
		log: silent
	});
	assert.deepEqual(calls, ['live_photo_motion']);
	assert.equal(res.unresolved.length, 0);
	assert.equal(res.migrations.length, 1);
	assert.equal(res.migrations[0].newTag, '20261019000000_live_photo_motion');
	const j = JSON.parse(readFileSync(join(cwd, 'drizzle/meta/_journal.json'), 'utf8'));
	assert.deepEqual(
		j.entries.map((e) => e.tag),
		['0000_init', '0001_other', '20261019000000_live_photo_motion']
	);
	assert.equal(j.entries[2].when, 1_900_000_000_000);
	assert.equal(sh(cwd, 'status', '--porcelain').trim(), '');
	for (const stale of [
		'drizzle/0001_live_photo_motion.sql',
		'drizzle/20261018185317_live_photo_motion.sql',
		'drizzle/meta/20261018185317_snapshot.json'
	]) {
		assert.throws(() => readFileSync(join(cwd, stale)), stale);
	}
	assert.match(sh(cwd, 'log', '--format=%B', '-1'), /Signed-off-by|feat/);
});

test('stops with a clear message on conflict markers instead of running prettier', () => {
	const cwd = fixture();
	sh(cwd, 'checkout', '-q', '-b', 'feat');
	addMigration(cwd, ['0000_init', '0001_feat'], '0001_feat', 'create table b(id);\n', 1);
	sh(cwd, 'add', '-A');
	sh(cwd, 'commit', '-q', '-m', 'feat');
	sh(cwd, 'checkout', '-q', 'main');
	addMigration(cwd, ['0000_init', '0001_other'], '0001_other', 'create table c(id);\n', 1);
	sh(cwd, 'add', '-A');
	sh(cwd, 'commit', '-q', '-m', 'other');
	sh(cwd, 'checkout', '-q', 'feat');
	let prettierRan = false;
	assert.throws(
		() =>
			rebaseMigration({
				cwd,
				base: 'main',
				fetch: false,
				drizzleKit: (name, dir) => {
					fakeKit([])(name, dir);
					writeFileSync(join(dir, 'drizzle/meta/0002_snapshot.json'), '<<<<<<< HEAD\n{}\n');
				},
				prettier: () => {
					prettierRan = true;
				},
				log: silent
			}),
		/Conflict markers found in: drizzle\/meta\/0002_snapshot\.json/
	);
	assert.equal(prettierRan, false);
});

test('stops and reports a schema.ts conflict without resolving it', () => {
	const cwd = fixture();
	put(cwd, 'src/lib/server/db/schema.ts', 'export const x = 0;\n');
	sh(cwd, 'add', '-A');
	sh(cwd, 'commit', '-q', '-m', 'schema');
	sh(cwd, 'checkout', '-q', '-b', 'feat');
	put(cwd, 'src/lib/server/db/schema.ts', 'export const x = 1;\n');
	sh(cwd, 'add', '-A');
	sh(cwd, 'commit', '-q', '-m', 'feat');
	sh(cwd, 'checkout', '-q', 'main');
	put(cwd, 'src/lib/server/db/schema.ts', 'export const x = 2;\n');
	sh(cwd, 'add', '-A');
	sh(cwd, 'commit', '-q', '-m', 'main');
	sh(cwd, 'checkout', '-q', 'feat');
	const calls = [];
	const res = rebaseMigration({
		cwd,
		base: 'main',
		fetch: false,
		drizzleKit: fakeKit(calls),
		prettier: () => {},
		log: silent
	});
	assert.deepEqual(res.unresolved, ['src/lib/server/db/schema.ts']);
	assert.deepEqual(calls, []);
	assert.match(readFileSync(join(cwd, 'src/lib/server/db/schema.ts'), 'utf8'), /<<<<<<</);
});
