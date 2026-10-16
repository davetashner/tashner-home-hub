// Shared helpers for CI gate scripts (ADR 0002). Protected path: changes need a human.
import { execFileSync } from 'node:child_process';

export function git(...args) {
	return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
}

export function trackedFiles() {
	return git('ls-files', '-z').split('\0').filter(Boolean);
}

/** Labels on the PR, from the PR_LABELS env var (JSON array set by the workflow). */
export function prLabels() {
	try {
		return new Set(JSON.parse(process.env.PR_LABELS ?? '[]'));
	} catch {
		return new Set();
	}
}

/** The merge base with the PR's base branch, or null outside a PR. */
export function baseRef() {
	const base = process.env.BASE_REF;
	if (!base) return null;
	return git('merge-base', `origin/${base}`, 'HEAD');
}

export function fail(gate, problems) {
	console.error(`\n✗ ${gate} failed:\n`);
	for (const p of problems) console.error(`  - ${p}`);
	console.error('');
	process.exit(1);
}

export function pass(gate, detail = '') {
	console.warn(`✓ ${gate}${detail ? `: ${detail}` : ''}`);
}
