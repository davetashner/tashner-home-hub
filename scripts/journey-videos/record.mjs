// Records one video per journey per device from the Playwright tests tagged with the journey's
// steps (journeys/registry.json, docs/journeys.md), then an HTML evidence report. Local tool only; never CI, never committed.
//
//   node scripts/journey-videos/record.mjs [--only J1,J4] [--device wall-landscape|wall-portrait|
//        ipad|ipad-landscape|ipad-portrait|iphone|all] [--skip-build] [--port 4400]
//
// Output: reports/journeys/<timestamp>/index.html (gitignored), with each device's clips and
// journey videos beside it. Without ffmpeg the per-test .webm clips and the report are kept.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listTests, loadRegistry, tagsFromListing } from '../journeys/trace.mjs';
import { cardArgs, clipArgs, concatArgs, concatList } from './assemble.mjs';
import { DEVICE_PROJECTS, grepFor, parseArgs, planJourneys, slug, testKey } from './plan.mjs';
import { endCard, renderReport, stepResults, titleCard } from './report.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const here = path.dirname(fileURLToPath(import.meta.url));
const log = (m) => process.stdout.write(`${m}\n`);

const have = (cmd) => spawnSync('which', [cmd], { stdio: 'ignore' }).status === 0;
const isFree = (port) =>
	new Promise((resolve) => {
		const s = net.createServer().once('error', () => resolve(false));
		s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
	});

/** Playwright's JSON report -> Map of testKey -> { status, error, video, duration }. */
export function readResults(report) {
	const out = new Map();
	const walk = (suite) => {
		for (const spec of suite.specs ?? []) {
			const run = spec.tests?.[0]?.results?.at(-1);
			if (!run) continue;
			out.set(testKey({ file: spec.file, title: spec.title }), {
				status: run.status,
				error: (run.error?.message ?? '').split('\n').find((l) => l.trim()) ?? '',
				video: run.attachments?.find((a) => a.name === 'video')?.path ?? null,
				duration: run.duration
			});
		}
		for (const c of suite.suites ?? []) walk(c);
	};
	for (const s of report.suites ?? []) walk(s);
	return out;
}

async function renderCards(cards, size, dir) {
	const { chromium } = await import('@playwright/test');
	const browser = await chromium.launch();
	const page = await browser.newPage({ viewport: size });
	const files = {};
	for (const [name, html] of Object.entries(cards)) {
		await page.setContent(html);
		files[name] = path.join(dir, `${name}.png`);
		await page.screenshot({ path: files[name] });
	}
	await browser.close();
	return files;
}

const ffmpeg = (args) => execFileSync('ffmpeg', args, { stdio: 'inherit' });

async function assemble(plan, device, steps, dir, size) {
	const base = `${plan.journey.id}-${slug(plan.journey.name)}`;
	const tmp = path.join(dir, 'tmp', base);
	fs.mkdirSync(tmp, { recursive: true });
	const cards = await renderCards(
		{ title: titleCard(plan.journey, device), end: endCard(plan.journey, device, steps) },
		size,
		tmp
	);
	const parts = [];
	const add = (name, args) => {
		const f = path.join(tmp, name);
		ffmpeg([...args.slice(0, -1), f]);
		parts.push(f);
	};
	add('00-title.mp4', cardArgs(cards.title, 'x', size));
	plan.tests.forEach((t, i) => {
		if (t.video) add(`${String(i + 1).padStart(2, '0')}-clip.mp4`, clipArgs(t.video, 'x', size));
	});
	add('99-end.mp4', cardArgs(cards.end, 'x', size, 4));
	const list = path.join(tmp, 'list.txt');
	fs.writeFileSync(list, concatList(parts));
	const out = path.join(dir, `${base}.mp4`);
	ffmpeg(concatArgs(list, out));
	return path.relative(path.dirname(dir), out);
}

function probeSize(file) {
	const [width, height] = execFileSync(
		'ffprobe',
		[
			'-v',
			'error',
			'-select_streams',
			'v:0',
			'-show_entries',
			'stream=width,height',
			'-of',
			'csv=p=0',
			file
		],
		{ encoding: 'utf8' }
	)
		.trim()
		.split(',')
		.map(Number);
	return { width, height };
}

async function main() {
	const opts = parseArgs(process.argv.slice(2));
	const port = opts.port ?? Number(process.env.E2E_PORT ?? 4400);
	if (!(await isFree(port))) throw new Error(`port ${port} is busy: pass --port <free port>`);
	const registry = loadRegistry();
	const tagged = tagsFromListing(listTests());
	const canAssemble = have('ffmpeg') && have('ffprobe');
	if (!canAssemble) log('ffmpeg not found: keeping the per-test clips and the report only.');
	if (!opts.skipBuild || !fs.existsSync(path.join(root, 'build'))) {
		execFileSync('pnpm', ['build'], { cwd: root, stdio: 'inherit' });
	}

	const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
	const outDir = path.join(root, 'reports', 'journeys', stamp);
	const devices = [];
	let failed = false;

	for (const device of opts.devices) {
		for (const project of DEVICE_PROJECTS[device]) {
			const plans = planJourneys(registry, tagged, project, opts.only);
			if (!plans.some((p) => p.tests.length)) {
				log(`${project}: no tagged tests for the selected journeys, skipping.`);
				continue;
			}
			const dir = path.join(outDir, project);
			const dataDir = path.join(dir, 'data'); // fresh per device: nothing carries over
			fs.mkdirSync(dataDir, { recursive: true });
			log(`\n== ${project} ==`);
			const run = spawnSync(
				'pnpm',
				[
					'exec',
					'playwright',
					'test',
					'-c',
					path.join(here, 'playwright.config.mjs'),
					'--project',
					project,
					'--grep',
					grepFor(plans)
				],
				{
					cwd: root,
					stdio: 'inherit',
					env: {
						...process.env,
						E2E_PORT: String(port),
						E2E_DATA_DIR: dataDir,
						JV_DATA_DIR: dataDir,
						JV_REGISTRY: path.join(root, 'journeys/registry.json'),
						JV_OUT: dir
					}
				}
			);
			const reportFile = path.join(dir, 'report.json');
			if (!fs.existsSync(reportFile))
				throw new Error(`${project}: Playwright wrote no report (exit ${run.status})`);
			const results = readResults(JSON.parse(fs.readFileSync(reportFile, 'utf8')));
			const rel = (p) => (p ? path.relative(outDir, p) : null);
			const journeys = [];
			let size = null;
			for (const plan of plans) {
				plan.tests = plan.tests.map((t) => ({
					...t,
					...(results.get(testKey(t)) ?? { status: 'skipped' })
				}));
				const steps = stepResults(plan.journey, plan.tests);
				if (steps.some((s) => s.result === 'failed')) failed = true;
				let video = null;
				const first = plan.tests.find((t) => t.video);
				if (canAssemble && first) {
					size ??= probeSize(first.video);
					video = await assemble(plan, project, steps, dir, size);
				}
				journeys.push({
					journey: plan.journey,
					steps,
					video,
					tests: plan.tests.map((t) => ({
						title: t.title,
						status: t.status,
						error: t.error,
						video: rel(t.video)
					}))
				});
			}
			devices.push({ name: device, project, journeys });
		}
	}

	fs.mkdirSync(outDir, { recursive: true });
	for (const d of devices)
		fs.rmSync(path.join(outDir, d.project, 'tmp'), { recursive: true, force: true });
	fs.writeFileSync(
		path.join(outDir, 'index.html'),
		renderReport({ generated: new Date().toISOString(), devices })
	);
	log(`\nReport: ${path.join(outDir, 'index.html')}`);
	if (failed) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
	main().catch((e) => {
		console.error(e.message);
		process.exit(1);
	});
