// Preloaded into the server under test (`node --import ./scripts/soak/probe.mjs build`).
// Appends one JSON line per interval: RSS, heap and event-loop delay. Timers are unref'd, so the
// probe never keeps the server alive and adds no traffic.
import { appendFileSync } from 'node:fs';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';

// V8 collects lazily, so heapUsed saw-tooths by tens of MB between GCs while RSS stays flat. A
// reading taken at a random phase of that cycle is not "retained memory" (the first full soak
// reported +154% heap with +2% RSS). Force a full GC before each sample so heapUsed means live data.
setFlagsFromString('--expose-gc');
const gc = runInNewContext('gc');

const file = process.env.SOAK_SAMPLES_FILE;
const every = Number(process.env.SOAK_SAMPLE_MS ?? 30_000);
if (file) {
	const loop = monitorEventLoopDelay({ resolution: 10 });
	loop.enable();
	setInterval(() => {
		gc();
		const m = process.memoryUsage();
		const line = {
			t: Math.round(process.uptime() * 1000),
			rss: m.rss,
			heapUsed: m.heapUsed,
			loopP99Ms: loop.percentile(99) / 1e6,
			loopMaxMs: loop.max / 1e6
		};
		loop.reset();
		appendFileSync(file, JSON.stringify(line) + '\n');
	}, every).unref();
}
