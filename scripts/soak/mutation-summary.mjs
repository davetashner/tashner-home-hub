// Turns Stryker's JSON report into a markdown job summary and reports/mutation/score.json.
//   node scripts/soak/mutation-summary.mjs [reports/mutation/mutation.json]
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { mutationScore } from './analyze.mjs';

const file = process.argv[2] ?? 'reports/mutation/mutation.json';
const result = mutationScore(JSON.parse(readFileSync(file, 'utf8')));
writeFileSync(
	join(dirname(file), 'score.json'),
	JSON.stringify({ mutationScore: result.score, ...result }, null, 2)
);

const lines = [
	`### Mutation score: ${result.score ?? 'n/a'}% (advisory)`,
	'',
	`${result.detected} of ${result.valid} mutants detected; ${result.survived} survived, ${result.noCoverage} had no test coverage.`,
	'',
	'Weakest files:',
	'',
	'| File | Score | Survived | No coverage |',
	'|---|---|---|---|',
	...result.files
		.slice(0, 10)
		.map((f) => `| ${f.file} | ${f.score ?? 'n/a'}% | ${f.survived} | ${f.noCoverage} |`)
];
process.stdout.write(lines.join('\n') + '\n');
if (process.env.GITHUB_STEP_SUMMARY)
	appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
