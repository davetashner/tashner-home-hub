// Preloaded into the server under test (`node --import ./scripts/soak/probe.mjs build`).
// Appends one JSON line per interval: RSS, heap and event-loop delay. Timers are unref'd, so the
// probe never keeps the server alive and adds no traffic.
import { appendFileSync } from 'node:fs';
import { monitorEventLoopDelay } from 'node:perf_hooks';

const file = process.env.SOAK_SAMPLES_FILE;
const every = Number(process.env.SOAK_SAMPLE_MS ?? 30_000);
if (file) {
	const loop = monitorEventLoopDelay({ resolution: 10 });
	loop.enable();
	setInterval(() => {
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
