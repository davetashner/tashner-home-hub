// ADR 0002 Tier 1 "Test integrity": no .only, no new skips/todos, no deleted tests,
// unless a human adds `human-approved`. Protected path: changes need a human.
import { readFileSync } from 'node:fs';
import { baseRef, fail, git, pass, prLabels, trackedFiles } from './lib.mjs';

const TEST_FILE = /\.(spec|test|e2e)\.(ts|js)$|^tests\//;
const ONLY = /\b(?:it|test|describe)\.only\s*\(/;
const SKIPS = /\b(?:it|test|describe)\.(?:skip|todo|fixme)\s*\(|\bxit\s*\(|\bxdescribe\s*\(/g;

const countSkips = (text) => (text.match(SKIPS) ?? []).length;

const problems = [];
let headSkips = 0;
for (const file of trackedFiles().filter((f) => TEST_FILE.test(f))) {
	const text = readFileSync(file, 'utf8');
	if (ONLY.test(text)) problems.push(`${file}: contains .only`);
	headSkips += countSkips(text);
}

const base = baseRef();
if (base) {
	const approved = prLabels().has('human-approved');
	const baseFiles = git('ls-tree', '-r', '--name-only', base)
		.split('\n')
		.filter((f) => TEST_FILE.test(f));
	let baseSkips = 0;
	for (const file of baseFiles) baseSkips += countSkips(git('show', `${base}:${file}`));
	const deleted = git('diff', '--name-only', '--diff-filter=D', `${base}...HEAD`)
		.split('\n')
		.filter((f) => f && TEST_FILE.test(f));
	if (!approved) {
		if (headSkips > baseSkips)
			problems.push(`skipped/todo tests went from ${baseSkips} to ${headSkips}`);
		for (const file of deleted) problems.push(`${file}: test file deleted`);
	}
}

if (problems.length) fail('test-integrity', problems);
pass('test-integrity', `${headSkips} skipped/todo tests`);
