// ADR 0002 "Where it runs": a self-hosted runner on this public repo must never run
// on pull_request, pull_request_target or workflow_run (which a PR can chain into).
// Fails if any workflow that targets a self-hosted runner mentions one of those events.
// Only `runs-on` values count as targeting a self-hosted runner.
// Deliberately conservative: it scans the whole file (comments stripped), so even a
// mention in an `if:` expression needs rewording. Protected path: changes need a human.
import { readdirSync, readFileSync } from 'node:fs';
import { fail, pass } from './lib.mjs';

const DIR = '.github/workflows';
// A runs-on value: the same line, plus following list items / labels / group lines.
const RUNS_ON = /runs-on:[^\n]*(?:\n[ \t]+(?:-|labels:|group:)[^\n]*)*/g;
const SELF_HOSTED = /(^|[^\w-])(self-hosted|tower)($|[^\w-])/;
const targetsSelfHosted = (body) => (body.match(RUNS_ON) ?? []).some((v) => SELF_HOSTED.test(v));
const FORBIDDEN = /\b(pull_request_target|pull_request|workflow_run)\b/;

const stripComments = (text) =>
	text
		.split('\n')
		.map((line) => line.replace(/(^|\s)#.*$/, '$1'))
		.join('\n');

const files = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f));
const problems = [];
const selfHosted = [];

for (const file of files) {
	const body = stripComments(readFileSync(`${DIR}/${file}`, 'utf8'));
	if (!targetsSelfHosted(body)) continue;
	selfHosted.push(file);
	const hit = body.match(FORBIDDEN);
	if (hit) {
		problems.push(`${file} targets a self-hosted runner but references "${hit[1]}"`);
	}
}

if (problems.length) fail('Self-hosted runner guard', problems);
pass('Self-hosted runner guard', `${selfHosted.length} self-hosted workflow(s), none on PR events`);
