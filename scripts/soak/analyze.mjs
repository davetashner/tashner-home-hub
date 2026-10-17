// Pure verdict logic for the nightly soak (ADR 0002 Tier 3). No I/O: unit-tested in
// src/lib/soak-analyze.spec.ts. Samples come from scripts/soak/probe.mjs.

/**
 * @typedef {{ t: number, rss: number, heapUsed: number, loopP99Ms: number, loopMaxMs: number }} Sample
 * t is milliseconds since the server started; rss and heapUsed are bytes.
 * @typedef {{ warmupMs: number, maxRssGrowthPct: number, maxHeapGrowthPct: number,
 *   maxLoopP99Ms: number, minSamples: number, window: number }} Thresholds
 */

/** @type {Thresholds} */
export const DEFAULT_THRESHOLDS = {
	warmupMs: 5 * 60_000, // allocator, JIT and caches settle; growth is judged after this
	maxRssGrowthPct: 25,
	maxHeapGrowthPct: 50, // advisory-ish: heap is noisy between GCs, RSS is the real gate
	maxLoopP99Ms: 200, // a stalled loop is a tap the family feels
	minSamples: 6, // fewer than this and the run proves nothing
	window: 3 // samples averaged (median) at each end, to ride out GC noise
};

/** @param {number[]} values */
export function median(values) {
	if (values.length === 0) return NaN;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Percent growth from `from` to `to`; 0 when there is no baseline. */
export function growthPct(from, to) {
	return from > 0 ? ((to - from) / from) * 100 : 0;
}

const round = (n, digits = 1) => (Number.isFinite(n) ? Number(n.toFixed(digits)) : n);

/**
 * Judges a run. Baseline = median of the first `window` samples after warm-up; final = median of
 * the last `window`. A server exit or an HTTP/page error fails the run regardless of memory.
 *
 * @param {Sample[]} samples
 * @param {{ serverExit?: string | null, errors?: string[] }} run
 * @param {Partial<Thresholds>} [overrides]
 */
export function analyzeSoak(samples, run = {}, overrides = {}) {
	const th = { ...DEFAULT_THRESHOLDS, ...overrides };
	const failures = [];
	if (run.serverExit) failures.push(`server exited: ${run.serverExit}`);
	for (const e of run.errors ?? []) failures.push(e);

	const settled = samples.filter((s) => s.t >= th.warmupMs);
	let rss = null;
	let heap = null;
	if (samples.length < th.minSamples) {
		failures.push(`only ${samples.length} samples (need ${th.minSamples})`);
	} else if (settled.length < th.window * 2) {
		failures.push(
			`only ${settled.length} samples after the ${th.warmupMs / 1000}s warm-up (need ${th.window * 2})`
		);
	} else {
		const head = settled.slice(0, th.window);
		const tail = settled.slice(-th.window);
		const side = (key) => {
			const from = median(head.map((s) => s[key]));
			const to = median(tail.map((s) => s[key]));
			return { baseline: from, final: to, growthPct: round(growthPct(from, to)) };
		};
		rss = side('rss');
		heap = side('heapUsed');
		if (rss.growthPct > th.maxRssGrowthPct)
			failures.push(`RSS grew ${rss.growthPct}% after warm-up (limit ${th.maxRssGrowthPct}%)`);
		if (heap.growthPct > th.maxHeapGrowthPct)
			failures.push(`heap grew ${heap.growthPct}% after warm-up (limit ${th.maxHeapGrowthPct}%)`);
	}

	const worstLoopP99Ms = samples.reduce((m, s) => Math.max(m, s.loopP99Ms), 0);
	if (worstLoopP99Ms > th.maxLoopP99Ms)
		failures.push(`event-loop p99 hit ${round(worstLoopP99Ms)} ms (limit ${th.maxLoopP99Ms} ms)`);

	return {
		ok: failures.length === 0,
		failures,
		thresholds: th,
		samples: samples.length,
		settledSamples: settled.length,
		rss,
		heap,
		worstLoopP99Ms: round(worstLoopP99Ms),
		worstLoopMaxMs: round(samples.reduce((m, s) => Math.max(m, s.loopMaxMs), 0))
	};
}

/**
 * Mutation score from a Stryker mutation-testing-elements report (reports/mutation/mutation.json):
 * (killed + timeout) / (killed + timeout + survived + no coverage). Ignored mutants, compile errors
 * and runtime errors are not counted. Returns per-file rows, worst score first.
 *
 * @param {{ files: Record<string, { mutants: { status: string }[] }> }} report
 */
export function mutationScore(report) {
	const tally = (mutants) => {
		const n = (s) => mutants.filter((m) => m.status === s).length;
		const detected = n('Killed') + n('Timeout');
		const valid = detected + n('Survived') + n('NoCoverage');
		return { detected, survived: n('Survived'), noCoverage: n('NoCoverage'), valid };
	};
	const rows = Object.entries(report.files ?? {}).map(([file, { mutants }]) => {
		const t = tally(mutants);
		return { file, ...t, score: t.valid ? round((t.detected / t.valid) * 100) : null };
	});
	const all = tally(Object.values(report.files ?? {}).flatMap((f) => f.mutants));
	return {
		score: all.valid ? round((all.detected / all.valid) * 100) : null,
		...all,
		files: rows.sort((a, b) => (a.score ?? 101) - (b.score ?? 101))
	};
}
