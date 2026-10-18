// Post-deploy smoke, STRICTLY READ-ONLY. For each device profile it loads the read-only page of
// each journey (Home with its notes card, calendar, chores, lists, meals, photos, music, games,
// and settings as a non-adult, which must bounce to /unlock) and checks: HTTP 200, hydrated, no
// console errors, no sideways scroll, a landmark visible. Any non-GET/HEAD request is aborted and
// FAILS the run. No clicks, no PIN, service workers blocked. See docs/deploy/smoke.md.
//
//   node scripts/deploy-smoke/run.mjs --base https://hub.davetashner.com [--pi]
//
// Screenshots go to reports/deploy-smoke/ (gitignored: the live site shows real family data).
import fs from 'node:fs';
import path from 'node:path';
import { createGuard, judge, parseArgs, piCommand, USAGE } from './lib.mjs';

let opts;
try {
	opts = parseArgs(process.argv.slice(2));
} catch (e) {
	process.stderr.write(`${e.message}\n${USAGE}\n`);
	process.exit(2);
}

const pw = await import('@playwright/test');
fs.mkdirSync(opts.out, { recursive: true });
const failures = [];
const guardHits = [];
let checked = 0;

async function visit(context, profile, spec) {
	const page = await context.newPage();
	const guard = createGuard();
	await page.route('**/*', guard.handler);
	const consoleErrors = [];
	page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
	page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
	const v = { status: null, finalUrl: '', hydrated: false, landmarkVisible: false, consoleErrors };
	try {
		const res = await page.goto(opts.base + spec.path, { timeout: opts.timeout });
		v.status = res?.status() ?? null;
		v.finalUrl = page.url();
		await page
			.waitForSelector('html[data-hydrated]', { state: 'attached', timeout: opts.timeout })
			.then(
				() => (v.hydrated = true),
				() => {}
			);
		await page.waitForTimeout(500); // let late console errors and layout settle
		v.landmarkVisible = await page.locator(spec.landmark).first().isVisible();
		Object.assign(
			v,
			await page.evaluate(() => ({
				scrollWidth: document.documentElement.scrollWidth,
				innerWidth: window.innerWidth
			}))
		);
		await page.screenshot({ path: path.join(opts.out, `${profile.name}-${spec.id}.png`) });
	} catch (e) {
		v.scrollWidth = v.innerWidth = 0;
		consoleErrors.push(`navigation failed: ${String(e.message).split('\n')[0]}`);
	}
	await page.close();
	guardHits.push(...guard.attempts.map((a) => `${profile.name} ${spec.path}: ${a}`));
	return [...judge(spec, v), ...guard.attempts.map((a) => `non-GET attempted: ${a}`)];
}

for (const profile of opts.profiles) {
	const device = profile.device ? pw.devices[profile.device] : {};
	const browser = await pw[profile.engine].launch();
	const context = await browser.newContext({
		...device,
		...(profile.viewport ? { viewport: profile.viewport } : {}),
		serviceWorkers: 'block'
	});
	for (const spec of opts.pages) {
		const fails = await visit(context, profile, spec);
		checked++;
		process.stdout.write(`${fails.length ? 'FAIL' : 'ok  '} ${profile.name} ${spec.path}\n`);
		for (const f of fails) {
			process.stdout.write(`       ${f}\n`);
			failures.push(`${profile.name} ${spec.path}: ${f}`);
		}
	}
	await browser.close();
}

if (opts.pi) process.stdout.write(`\nPi screenshot (run by hand): ${piCommand()}\n`);
process.stdout.write(
	`\n${checked} page checks on ${opts.profiles.length} devices against ${opts.base}\n`
);
process.stdout.write(
	`screenshots: ${opts.out} (gitignored; real family data, never commit or share)\n`
);
if (guardHits.length)
	process.stdout.write(`READ-ONLY VIOLATION: ${guardHits.length} write request(s) aborted\n`);
if (failures.length) {
	process.stdout.write(`FAILED: ${failures.length} problem(s)\n`);
	process.exit(1);
}
process.stdout.write('PASSED\n');
