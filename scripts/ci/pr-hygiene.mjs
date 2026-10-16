// ADR 0002: DCO sign-off on every commit, a `Closes hub-…` line per PR, and small PRs.
// Protected path: changes need a human.
import { baseRef, fail, git, pass, prLabels } from './lib.mjs';

const MAX_CHANGED_LINES = 800;
const EXCLUDED = [/^pnpm-lock\.yaml$/, /^\.beads\//, /^tests\/visual\/baselines\//];

const base = baseRef();
if (!base) {
	pass('pr-hygiene', 'not a pull request; skipped');
	process.exit(0);
}

const problems = [];
const isBot = /\[bot\]$/.test(process.env.PR_AUTHOR ?? '');

for (const sha of git('rev-list', `${base}..HEAD`).split('\n').filter(Boolean)) {
	const message = git('show', '-s', '--format=%B', sha);
	const parents = git('show', '-s', '--format=%P', sha).split(' ').length;
	if (parents > 1) continue; // merge commits from updating the branch
	if (!isBot && !/^Signed-off-by: .+ <.+>$/m.test(message)) {
		problems.push(`${sha.slice(0, 7)} is missing a Signed-off-by line (use git commit -s)`);
	}
}

if (!isBot && !/^Closes hub-[a-z0-9.]+\s*$/im.test(process.env.PR_BODY ?? '')) {
	problems.push('PR body needs at least one line like `Closes hub-abc.1`');
}

let changed = 0;
for (const line of git('diff', '--numstat', `${base}...HEAD`).split('\n').filter(Boolean)) {
	const [added, removed, file] = line.split('\t');
	if (EXCLUDED.some((re) => re.test(file)) || added === '-') continue;
	changed += Number(added) + Number(removed);
}
// Bootstrap: the PR that introduces this gate can't be held to its size limit.
let gateOnBase = true;
try {
	git('cat-file', '-e', `${base}:scripts/ci/pr-hygiene.mjs`);
} catch {
	gateOnBase = false;
}
if (gateOnBase && changed > MAX_CHANGED_LINES && !prLabels().has('large-pr')) {
	problems.push(
		`${changed} changed lines (limit ${MAX_CHANGED_LINES}); split the PR or ask a human for \`large-pr\``
	);
}

if (problems.length) fail('pr-hygiene', problems);
pass('pr-hygiene', `${changed} changed lines`);
