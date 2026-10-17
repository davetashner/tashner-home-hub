// Nightly soak (ADR 0002 Tier 3): drives the production build (`node build`) with realistic wall
// traffic for a while and fails if memory grows or the server errors. Run after `pnpm build`.
//   node scripts/soak/soak.mjs [--minutes 25] [--out soak-report]
// Env: SOAK_PORT (4300), SOAK_SAMPLE_MS (30000), SOAK_WARMUP_MS (default: 20% of the run, max 5 min),
//      SOAK_SSE_PATH (hold a Server-Sent Events stream open; skipped when unset: the app has none yet).
import { spawn } from 'node:child_process';
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { analyzeSoak } from './analyze.mjs';

const arg = (name, fallback) => {
	const i = process.argv.indexOf(`--${name}`);
	return i > -1 ? process.argv[i + 1] : fallback;
};
const minutes = Number(arg('minutes', process.env.SOAK_MINUTES ?? 25));
const outDir = arg('out', 'soak-report');
const port = Number(process.env.SOAK_PORT ?? 4300);
const sampleMs = Number(process.env.SOAK_SAMPLE_MS ?? 30_000);
const durationMs = minutes * 60_000;
const warmupMs = Number(process.env.SOAK_WARMUP_MS ?? Math.min(5 * 60_000, durationMs * 0.2));
const sseUrlPath = process.env.SOAK_SSE_PATH;
const base = `http://127.0.0.1:${port}`;
const PIN = '4817'; // synthetic; the data dir is throwaway

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(outDir, { recursive: true });
const dataDir = mkdtempSync(join(tmpdir(), 'hub-soak-'));
const samplesFile = join(dataDir, 'samples.jsonl');

// ---- server ----
const serverLog = [];
let serverExit = null;
let stopping = false;
const server = spawn(process.execPath, ['--import', './scripts/soak/probe.mjs', 'build'], {
	env: {
		...process.env,
		HOST: '127.0.0.1',
		PORT: String(port),
		DATA_DIR: join(dataDir, 'data'),
		SOAK_SAMPLES_FILE: samplesFile,
		SOAK_SAMPLE_MS: String(sampleMs)
	},
	stdio: ['ignore', 'pipe', 'pipe']
});
for (const stream of [server.stdout, server.stderr])
	stream.on('data', (d) => {
		serverLog.push(...String(d).split('\n').filter(Boolean));
		if (serverLog.length > 200) serverLog.splice(0, serverLog.length - 200);
	});
server.on('exit', (code, signal) => {
	if (!stopping) serverExit = `code ${code} signal ${signal}`;
});

const errors = [];
const noteError = (msg) => {
	if (errors.length < 20) errors.push(msg);
};
const counters = { loops: 0, taps: 0, pages: 0, sseBytes: 0, sseReconnects: 0 };

async function waitHealthy() {
	for (let i = 0; i < 120; i++) {
		if (serverExit) throw new Error(`server died on start: ${serverExit}`);
		try {
			if ((await fetch(`${base}/healthz`)).ok) return;
		} catch {
			/* not up yet */
		}
		await sleep(500);
	}
	throw new Error('server never became healthy');
}

// ---- optional SSE stream, reopened if it drops ----
async function holdSse(signal) {
	while (!signal.aborted) {
		try {
			const res = await fetch(base + sseUrlPath, { signal });
			for await (const chunk of res.body) counters.sseBytes += chunk.length;
		} catch {
			if (signal.aborted) return;
		}
		counters.sseReconnects++;
		await sleep(1000);
	}
}

// ---- traffic ----
async function drive(deadline) {
	const browser = await chromium.launch();
	const context = await browser.newContext({
		baseURL: base,
		viewport: { width: 2560, height: 1440 },
		serviceWorkers: 'block'
	});
	const api = context.request;
	const setup = await api.post('/api/setup', {
		data: { name: 'Soak Adult', color: 'member-1', pin: PIN, remember: true }
	});
	if (!setup.ok()) throw new Error(`setup failed: ${setup.status()}`);
	const kid = await (
		await api.post('/api/members', {
			data: { name: 'Soak Kid', role: 'child', color: 'member-4', avatar: '🦊' }
		})
	).json();

	const page = await context.newPage();
	page.on('pageerror', (e) => noteError(`page error: ${e.message}`));
	page.on('response', (r) => {
		if (r.status() >= 500)
			noteError(`${r.request().method()} ${new URL(r.url()).pathname} -> ${r.status()}`);
	});
	const visit = async (path) => {
		await page.goto(path, { waitUntil: 'load', timeout: 30_000 });
		counters.pages++;
		await page.waitForTimeout(2000); // a family looks at a screen for more than a frame
	};

	while (Date.now() < deadline && !serverExit) {
		try {
			// A fresh chore each loop (a chore can only be done once a day), tapped like a kid would.
			const title = `Soak chore ${counters.loops}`;
			await api.post('/api/chores', {
				data: {
					title,
					icon: '🧸',
					stars: 1,
					timeOfDay: 'morning',
					memberIds: [kid.id],
					schedule: { type: 'daily' }
				}
			});
			await visit('/');
			await visit('/calendar');
			await visit(`/chores?member=${kid.id}`);
			const card = page
				.getByTestId('chore-card')
				.filter({ has: page.getByRole('heading', { name: title }) });
			const tap = card.getByTestId('did-it');
			if (await tap.isVisible({ timeout: 5000 }).catch(() => false)) {
				await tap.click();
				counters.taps++;
				await page.waitForTimeout(1500);
			}
			await api.get('/api/photo/slideshow?limit=50');
			await visit('/'); // the photo frame lives on the home screen
			counters.loops++;
		} catch (e) {
			noteError(`traffic: ${String(e.message).split('\n')[0]}`);
			if (errors.length >= 20) break;
		}
	}
	await browser.close();
}

// ---- run ----
const started = Date.now();
const abort = new AbortController();
let verdict;
try {
	await waitHealthy();
	process.stdout.write(
		`soak: ${minutes} min against ${base}, samples every ${sampleMs / 1000}s` + '\n'
	);
	const sse = sseUrlPath ? holdSse(abort.signal) : null;
	await drive(Date.now() + durationMs);
	await sleep(sampleMs + 1000); // one more sample taken after the traffic stops
	abort.abort();
	await sse;
} catch (e) {
	noteError(`harness: ${e.message}`);
} finally {
	stopping = true;
	server.kill('SIGTERM');
}

const samples = existsSync(samplesFile)
	? readFileSync(samplesFile, 'utf8')
			.split('\n')
			.filter(Boolean)
			.map((l) => JSON.parse(l))
	: [];
verdict = analyzeSoak(samples, { serverExit, errors }, { warmupMs });
const report = {
	...verdict,
	// Flat keys read by the morning report (hub-ugl.9).
	rssGrowthPct: verdict.rss?.growthPct ?? null,
	heapGrowthPct: verdict.heap?.growthPct ?? null,
	sseReconnects: counters.sseReconnects,
	minutes,
	wallClockMinutes: Number(((Date.now() - started) / 60_000).toFixed(1)),
	traffic: { ...counters, sse: sseUrlPath ?? 'skipped (no SSE endpoint configured)' },
	serverLogTail: serverLog.slice(-20),
	series: samples
};
writeFileSync(join(outDir, 'soak-report.json'), JSON.stringify(report, null, 2));

const mb = (b) => `${(b / 1048576).toFixed(0)} MB`;
const summary = [
	`### Soak ${verdict.ok ? 'passed' : 'FAILED'}`,
	'',
	`- Duration: ${minutes} min, ${verdict.samples} samples; ${counters.loops} loops, ${counters.pages} page loads, ${counters.taps} chore taps`,
	verdict.rss
		? `- RSS: ${mb(verdict.rss.baseline)} -> ${mb(verdict.rss.final)} (${verdict.rss.growthPct}% after warm-up, limit ${verdict.thresholds.maxRssGrowthPct}%)`
		: '- RSS: not enough samples',
	verdict.heap
		? `- Heap: ${mb(verdict.heap.baseline)} -> ${mb(verdict.heap.final)} (${verdict.heap.growthPct}%)`
		: '',
	`- Event loop p99 worst: ${verdict.worstLoopP99Ms} ms, max ${verdict.worstLoopMaxMs} ms`,
	...verdict.failures.map((f) => `- FAIL: ${f}`)
]
	.filter(Boolean)
	.join('\n');
writeFileSync(join(outDir, 'soak-summary.md'), summary + '\n');
process.stdout.write(summary + '\n');
if (process.env.GITHUB_STEP_SUMMARY)
	appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
rmSync(dataDir, { recursive: true, force: true });
process.exit(verdict.ok ? 0 : 1);
