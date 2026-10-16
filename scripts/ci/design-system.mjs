// ADR 0002 Tier 2: design-system discipline. Protected path.
// 1. Raw color literals (hex, rgb/hsl/hwb/lab/lch/oklab/oklch/color()) are only allowed in the
//    token file src/routes/layout.css. Everything else must use a token.
// 2. No Tailwind arbitrary values (`w-[37px]`, `text-[#fff]`) in class attributes.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fail, pass } from './lib.mjs';

const TOKEN_FILE = 'src/routes/layout.css';
const EXT = /\.(svelte|css|ts|js)$/;
const COLOR =
	/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(\s*[-\d.%\s/,a-z]/g;
const CLASS_ATTR = /\bclass(?::[\w-]+)?\s*=\s*(?:"[^"]*"|'[^']*'|\{[^}]*\})/g;
const ARBITRARY = /(?:^|[\s"'`:{])-?[a-z][\w-]*-\[[^\]\s]+\]/;

export function scan(file, text) {
	const problems = [];
	const lines = text.split('\n');
	if (file !== TOKEN_FILE && !file.endsWith('.test.ts') && !file.endsWith('.spec.ts')) {
		lines.forEach((line, i) => {
			// Skip svg entity refs / url fragments like &#39; and href="#top".
			const cleaned = line.replace(/&#\d+;/g, '').replace(/(href|id|for)="#[^"]*"/g, '');
			for (const m of cleaned.matchAll(COLOR)) {
				problems.push(
					`${file}:${i + 1}: raw color \`${m[0].trim()}\`; use a token from ${TOKEN_FILE}`
				);
			}
		});
	}
	if (file.endsWith('.svelte')) {
		for (const m of text.matchAll(CLASS_ATTR)) {
			if (ARBITRARY.test(m[0])) {
				const line = text.slice(0, m.index).split('\n').length;
				problems.push(
					`${file}:${line}: Tailwind arbitrary value in \`${m[0].slice(0, 80)}\`; add a design token instead`
				);
			}
		}
	}
	return problems;
}

if (
	import.meta.url === `file://${process.argv[1]}` ||
	process.argv[1]?.endsWith('design-system.mjs')
) {
	const problems = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
		encoding: 'utf8'
	})
		.split('\0')
		.filter(Boolean)
		.filter((f) => f.startsWith('src/') && EXT.test(f))
		.flatMap((f) => {
			try {
				return scan(f.split(path.sep).join('/'), readFileSync(f, 'utf8'));
			} catch {
				return []; // deleted in the working tree
			}
		});
	if (problems.length) fail('Design-system discipline', problems);
	pass('Design-system discipline');
}
