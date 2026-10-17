export interface Sample {
	t: number;
	rss: number;
	heapUsed: number;
	loopP99Ms: number;
	loopMaxMs: number;
}
export interface Thresholds {
	warmupMs: number;
	maxRssGrowthPct: number;
	maxHeapGrowthPct: number;
	maxLoopP99Ms: number;
	minSamples: number;
	window: number;
}
export interface Growth {
	baseline: number;
	final: number;
	growthPct: number;
}
export interface Verdict {
	ok: boolean;
	failures: string[];
	thresholds: Thresholds;
	samples: number;
	settledSamples: number;
	rss: Growth | null;
	heap: Growth | null;
	worstLoopP99Ms: number;
	worstLoopMaxMs: number;
}
export const DEFAULT_THRESHOLDS: Thresholds;
export function median(values: number[]): number;
export function growthPct(from: number, to: number): number;
export function analyzeSoak(
	samples: Sample[],
	run?: { serverExit?: string | null; errors?: string[] },
	overrides?: Partial<Thresholds>
): Verdict;
export interface MutationFile {
	file: string;
	detected: number;
	survived: number;
	noCoverage: number;
	valid: number;
	score: number | null;
}
export function mutationScore(report: {
	files: Record<string, { mutants: { status: string }[] }>;
}): {
	score: number | null;
	detected: number;
	survived: number;
	noCoverage: number;
	valid: number;
	files: MutationFile[];
};
