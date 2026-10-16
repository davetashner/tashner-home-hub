// ADR 0002 Tier 2: bundle budget. Reads the Vite manifest from `pnpm build`
// and compares gzip sizes against budgets.json. Protected path.
import { readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fail, pass } from './lib.mjs';

const clientDir = '.svelte-kit/output/client';
const manifestPath = path.join(clientDir, '.vite/manifest.json');
if (!existsSync(manifestPath)) {
	fail('Bundle budget', [`${manifestPath} not found; run \`pnpm build\` first`]);
}
const budgets = JSON.parse(readFileSync('budgets.json', 'utf8'));
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

const sizeCache = new Map();
const gz = (file) => {
	if (!sizeCache.has(file)) {
		sizeCache.set(file, gzipSync(readFileSync(path.join(clientDir, file))).length);
	}
	return sizeCache.get(file);
};

/** JS files (and CSS) reachable from manifest keys via static imports. */
function closure(keys) {
	const js = new Set();
	const css = new Set();
	const seen = new Set();
	const visit = (key) => {
		if (seen.has(key) || !manifest[key]) return;
		seen.add(key);
		const chunk = manifest[key];
		js.add(chunk.file);
		for (const c of chunk.css ?? []) css.add(c);
		for (const i of chunk.imports ?? []) visit(i);
	};
	keys.forEach(visit);
	return { js, css };
}

const byName = (re) =>
	Object.keys(manifest).filter((k) => re.test(manifest[k].name ?? '') && manifest[k].isEntry);
const entries = byName(/^entry\//);
const layout = byName(/^nodes\/0$/);
const pages = byName(/^nodes\/\d+$/).filter(
	(k) => !layout.includes(k) && manifest[k].name !== 'nodes/1'
);

const sum = (files) => [...files].reduce((n, f) => n + gz(f), 0);
const kb = (n) => (n / 1000).toFixed(1);
const problems = [];
let worst = { total: 0, page: '(none)' };

for (const page of pages.length ? pages : [null]) {
	const { js } = closure([...entries, ...layout, ...(page ? [page] : [])]);
	const total = sum(js);
	if (total >= worst.total) worst = { total, page: page ? manifest[page].name : '(none)' };
}
if (worst.total > budgets.initialJsGzKB * 1000) {
	problems.push(
		`Initial JS (entry + layout + page ${worst.page}) is ${kb(worst.total)} KB gz, budget ${budgets.initialJsGzKB} KB`
	);
}

const allCss = new Set(Object.values(manifest).flatMap((c) => c.css ?? []));
const cssTotal = sum(allCss);
if (cssTotal > budgets.cssGzKB * 1000) {
	problems.push(`CSS is ${kb(cssTotal)} KB gz, budget ${budgets.cssGzKB} KB`);
}

let largest = { size: 0, file: '(none)' };
for (const chunk of Object.values(manifest)) {
	if (!chunk.file.endsWith('.js')) continue;
	const size = gz(chunk.file);
	if (size > largest.size) largest = { size, file: chunk.file };
	// Entry runtime chunks count against the initial budget; route and shared chunks get their own.
	if (size > budgets.routeChunkGzKB * 1000 && !/\/entry\//.test(chunk.file)) {
		problems.push(`Chunk ${chunk.file} is ${kb(size)} KB gz, budget ${budgets.routeChunkGzKB} KB`);
	}
}

console.warn(
	`Bundle: initial JS ${kb(worst.total)}/${budgets.initialJsGzKB} KB gz (worst page ${worst.page}), ` +
		`CSS ${kb(cssTotal)}/${budgets.cssGzKB} KB gz, largest chunk ${kb(largest.size)}/${budgets.routeChunkGzKB} KB gz (${largest.file})`
);
if (problems.length) fail('Bundle budget', problems);
pass('Bundle budget');
