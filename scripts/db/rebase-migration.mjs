#!/usr/bin/env node
// Rebase the checked-out feature branch onto origin/main and, when the branch adds a Drizzle
// migration that collides with main's (same number, stale snapshot chain, journal conflict),
// regenerate it with the next free number. Never pushes. See CLAUDE.md > Build & Test.
//
//   node scripts/db/rebase-migration.mjs [--base origin/main] [--continue]
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const JOURNAL = 'drizzle/meta/_journal.json';
const DB_SPEC = 'src/lib/server/db/db.spec.ts';
const say = (m = '') => process.stdout.write(`${m}\n`);
const TABLE_COUNT = /(expect\(tables\)\.toHaveLength\()(\d+)(\))/;

function defaultDrizzleKit(name, cwd) {
	execFileSync('pnpm', ['exec', 'drizzle-kit', 'generate', '--name', name], {
		cwd,
		stdio: 'inherit'
	});
}

function defaultPrettier(cwd) {
	execFileSync('pnpm', ['exec', 'prettier', '--write', 'drizzle/meta'], { cwd, stdio: 'inherit' });
}

/** Lines of the old SQL that do not appear in the regenerated SQL (hand edits to re-apply). */
export function sqlHandEdits(oldSql, newSql) {
	const norm = (s) =>
		s
			.split('\n')
			.map((l) => l.trim())
			.filter((l) => l && l !== '--> statement-breakpoint');
	const fresh = new Set(norm(newSql));
	const old = new Set(norm(oldSql));
	return {
		onlyInOld: [...old].filter((l) => !fresh.has(l)),
		onlyInNew: [...fresh].filter((l) => !old.has(l))
	};
}

export function rebaseMigration(opts = {}) {
	const {
		cwd = process.cwd(),
		base = 'origin/main',
		fetch = base.startsWith('origin/'),
		drizzleKit = defaultDrizzleKit,
		prettier = defaultPrettier,
		log = say,
		now = () => Date.now()
	} = opts;

	const git = (args, o = {}) =>
		execFileSync('git', args, {
			cwd,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
			env: { ...process.env, GIT_EDITOR: 'true' },
			...o
		});
	const tryGit = (args) => {
		try {
			return { ok: true, out: git(args) };
		} catch (e) {
			return { ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
		}
	};
	const inRebase = () =>
		['rebase-merge', 'rebase-apply'].some((d) =>
			existsSync(resolve(cwd, git(['rev-parse', '--git-path', d]).trim()))
		);
	const show = (rev, path) => {
		const r = tryGit(['show', `${rev}:${path}`]);
		return r.ok ? r.out : null;
	};
	const readJournal = () => JSON.parse(readFileSync(join(cwd, JOURNAL), 'utf8'));
	const result = { rebased: false, migrations: [], unresolved: [] };

	const fixMigration = (sqlPath) => {
		const oldTag = sqlPath.replace(/^drizzle\//, '').replace(/\.sql$/, '');
		const num = /^\d+/.exec(oldTag)[0]; // NNNN or a 14-digit timestamp
		const name = oldTag.replace(/^\d+_/, '');
		const oldSql = show('REBASE_HEAD', sqlPath) ?? '';
		log(`Migration ${oldTag}: regenerating on top of ${base}`);

		git(['checkout', 'HEAD', '--', JOURNAL]);
		const snap = `drizzle/meta/${num}_snapshot.json`;
		if (show('HEAD', snap) !== null) git(['checkout', 'HEAD', '--', snap]);
		else {
			tryGit(['rm', '-f', '--quiet', '--', snap]);
			rmSync(join(cwd, snap), { force: true });
		}
		tryGit(['rm', '-f', '--quiet', '--', sqlPath]);
		rmSync(join(cwd, sqlPath), { force: true });
		const dataDir = join(cwd, 'data');
		if (existsSync(dataDir)) {
			for (const f of readdirSync(dataDir)) {
				if (f.startsWith('hub.db')) rmSync(join(dataDir, f), { force: true });
			}
		}

		drizzleKit(name, cwd);

		const journal = readJournal();
		const entries = journal.entries;
		if (entries.length >= 2) {
			entries[entries.length - 1].when = Math.max(now(), entries[entries.length - 2].when + 1);
		}
		writeFileSync(join(cwd, JOURNAL), `${JSON.stringify(journal, null, '\t')}\n`);
		prettier(cwd);

		const newTag = entries[entries.length - 1].tag;
		const newSql = readFileSync(join(cwd, `drizzle/${newTag}.sql`), 'utf8');
		const edits = sqlHandEdits(oldSql, newSql);
		result.migrations.push({ oldTag, newTag, ...edits });
		log(`  ${oldTag} -> ${newTag}`);
		if (edits.onlyInOld.length > 0) {
			log('');
			log('!!! HAND EDITS TO RE-CHECK: lines in the OLD sql missing from the regenerated sql !!!');
			for (const l of edits.onlyInOld) log(`  - ${l}`);
			log(`  (regenerated lines not in the old sql:)`);
			for (const l of edits.onlyInNew) log(`  + ${l}`);
			log(`  Re-apply by hand in drizzle/${newTag}.sql, then amend/commit.`);
			log('');
		}
		git(['add', '--', 'drizzle']);
	};

	const fixTableCount = () => {
		const read = (rev) => {
			const src = rev ? show(rev, DB_SPEC) : readFileSync(join(cwd, DB_SPEC), 'utf8');
			const m = src && TABLE_COUNT.exec(src);
			return m ? Number(m[2]) : null;
		};
		const mine = read('REBASE_HEAD');
		const parent = read('REBASE_HEAD^');
		const upstream = read('HEAD');
		if (mine === null || parent === null || upstream === null) return false;
		if (mine === parent) return false;
		// Two branches that each add one table merge cleanly to the same (wrong) count.
		const next = upstream + (mine - parent);
		if (next === upstream) return false;
		let src = readFileSync(join(cwd, DB_SPEC), 'utf8');
		if (src.includes('<<<<<<<')) {
			src = show('HEAD', DB_SPEC);
			log(`  WARNING: ${DB_SPEC} conflicted; took main's copy. Re-apply the branch's other edits.`);
		}
		writeFileSync(join(cwd, DB_SPEC), src.replace(TABLE_COUNT, `$1${next}$3`));
		git(['add', '--', DB_SPEC]);
		log(`  ${DB_SPEC}: table count ${upstream} -> ${next}`);
		return true;
	};

	if (!inRebase()) {
		if (git(['status', '--porcelain', '--untracked-files=no']).trim()) {
			throw new Error('Working tree has uncommitted changes; commit or stash them first.');
		}
		if (fetch) git(['fetch', 'origin', base.replace(/^origin\//, '')]);
		const r = tryGit(['rebase', base]);
		if (r.ok) {
			result.rebased = true;
			log(`Rebased onto ${base} cleanly.`);
			return result;
		}
	}

	while (inRebase()) {
		const unmerged = git(['diff', '--name-only', '--diff-filter=U']).split('\n').filter(Boolean);
		const added = tryGit([
			'diff-tree',
			'--no-commit-id',
			'--name-status',
			'-r',
			'--root',
			'REBASE_HEAD',
			'--',
			'drizzle'
		])
			.out.split('\n')
			.map((l) => l.split('\t'))
			.filter(([s, p]) => s === 'A' && p?.endsWith('.sql'))
			.map(([, p]) => p);

		for (const sqlPath of added) {
			const num = /^drizzle\/(\d+)_/.exec(sqlPath)[1];
			const taken = tryGit(['ls-tree', '--name-only', 'HEAD', 'drizzle/'])
				.out.split('\n')
				.some((p) => p.startsWith(`drizzle/${num}_`) && p !== sqlPath);
			if (taken || unmerged.some((p) => p.startsWith('drizzle/'))) fixMigration(sqlPath);
		}
		fixTableCount();

		const left = git(['diff', '--name-only', '--diff-filter=U']).split('\n').filter(Boolean);
		if (left.length > 0) {
			result.unresolved = left;
			log('Rebase stopped on conflicts this script does not resolve:');
			for (const f of left) log(`  ${f}`);
			log('Resolve them, `git add` them, then rerun with --continue.');
			return result;
		}
		const c = tryGit(['rebase', '--continue']);
		if (!c.ok && !inRebase()) throw new Error(`rebase --continue failed:\n${c.out}`);
	}
	result.rebased = true;
	return result;
}

function main() {
	const args = process.argv.slice(2);
	const bi = args.indexOf('--base');
	const base = bi >= 0 ? args[bi + 1] : 'origin/main';
	const res = rebaseMigration({ base });
	if (res.unresolved.length > 0) process.exit(2);
	const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim();
	if (res.migrations.length > 0) {
		say('Migrations renumbered:');
		for (const m of res.migrations) say(`  ${m.oldTag} -> ${m.newTag}`);
		say('Run pnpm check, pnpm lint and pnpm test before pushing.');
	}
	say(`Not pushed. When ready: git push --force-with-lease origin ${branch}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
