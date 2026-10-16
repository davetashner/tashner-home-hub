// ADR 0002: protected files (thresholds, baselines, CI config, ADRs) can't change
// without the `human-approved` label. Protected path: changes need a human.
import { baseRef, fail, git, pass, prLabels } from './lib.mjs';
import { PROTECTED } from './protected-paths.mjs';

const base = baseRef();
if (!base) {
	pass('gate-integrity', 'not a pull request; skipped');
	process.exit(0);
}

// Bootstrap: the PR that introduces this gate can't be held to it.
try {
	git('cat-file', '-e', `${base}:scripts/ci/gate-integrity.mjs`);
} catch {
	pass('gate-integrity', 'gate not on base branch yet (bootstrap)');
	process.exit(0);
}

const changed = git('diff', '--name-only', `${base}...HEAD`).split('\n').filter(Boolean);
const touched = changed.filter((file) => PROTECTED.some((re) => re.test(file)));

if (touched.length && !prLabels().has('human-approved')) {
	fail('gate-integrity', [
		...touched.map((file) => `${file} is protected`),
		'A human must review and add the `human-approved` label. Agents must never add it.'
	]);
}
pass(
	'gate-integrity',
	touched.length ? 'protected changes approved by a human' : 'no protected files changed'
);
