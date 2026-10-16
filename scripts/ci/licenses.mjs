// ADR 0002 Tier 1 "Licenses" gate. Protected path: changes need a human.
import { execFileSync } from 'node:child_process';
import { fail, pass } from './lib.mjs';

const ALLOWED = new Set([
	'MIT',
	'MIT-0',
	'ISC',
	'0BSD',
	'BSD-2-Clause',
	'BSD-3-Clause',
	'Apache-2.0',
	'CC0-1.0',
	'CC-BY-4.0',
	'BlueOak-1.0.0',
	'Python-2.0',
	'MPL-2.0',
	'Unlicense',
	'LGPL-3.0-or-later',
	'OFL-1.1'
]);

const raw = execFileSync('pnpm', ['licenses', 'list', '--json'], {
	encoding: 'utf8',
	maxBuffer: 64 * 1024 * 1024
});
const byLicense = JSON.parse(raw);

const allowedExpression = (license) =>
	license
		.replace(/[()]/g, '')
		.split(/\s+OR\s+/i)
		.some((part) => part.split(/\s+AND\s+/i).every((p) => ALLOWED.has(p.trim())));

const problems = [];
let count = 0;
for (const [license, packages] of Object.entries(byLicense)) {
	count += packages.length;
	if (allowedExpression(license)) continue;
	for (const pkg of packages) problems.push(`${pkg.name}@${pkg.versions.join(',')}: ${license}`);
}

if (problems.length) fail('licenses', problems);
pass('licenses', `${count} packages`);
