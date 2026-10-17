import { describe, expect, it } from 'vitest';
import {
	analyzeSoak,
	growthPct,
	mutationScore,
	median,
	type Sample
} from '../../scripts/soak/analyze.mjs';

const MB = 1024 * 1024;
/** One sample every 30 s; rss and heap come from the callbacks. */
function series(
	count: number,
	rss: (i: number) => number,
	heap: (i: number) => number = () => 20 * MB,
	loop = 5
): Sample[] {
	return Array.from({ length: count }, (_, i) => ({
		t: i * 30_000,
		rss: rss(i) * MB,
		heapUsed: heap(i),
		loopP99Ms: loop,
		loopMaxMs: loop * 2
	}));
}
const FAST = { warmupMs: 60_000 };

describe('median / growthPct', () => {
	it('takes the middle value, or the mean of the middle two', () => {
		expect(median([3, 1, 2])).toBe(2);
		expect(median([4, 1, 2, 3])).toBe(2.5);
		expect(median([])).toBeNaN();
	});
	it('is zero without a baseline', () => {
		expect(growthPct(0, 50)).toBe(0);
		expect(growthPct(100, 125)).toBe(25);
	});
});

describe('analyzeSoak', () => {
	it('passes a flat run', () => {
		const v = analyzeSoak(
			series(20, () => 150),
			{},
			FAST
		);
		expect(v.ok).toBe(true);
		expect(v.rss?.growthPct).toBe(0);
		expect(v.failures).toEqual([]);
	});

	it('ignores growth during warm-up', () => {
		const v = analyzeSoak(
			series(20, (i) => (i < 2 ? 80 : 150)),
			{},
			FAST
		);
		expect(v.ok).toBe(true);
	});

	it('fails when RSS keeps growing past the limit', () => {
		const v = analyzeSoak(
			series(30, (i) => 100 + i * 3),
			{},
			FAST
		);
		expect(v.ok).toBe(false);
		expect(v.failures[0]).toMatch(/RSS grew \d+(\.\d)?% after warm-up/);
	});

	it('allows growth at exactly the limit', () => {
		const v = analyzeSoak(
			series(20, (i) => (i < 10 ? 100 : 125)),
			{},
			{ ...FAST, window: 3 }
		);
		expect(v.rss?.growthPct).toBe(25);
		expect(v.ok).toBe(true);
	});

	it('rides out a single GC spike at the end', () => {
		const v = analyzeSoak(
			series(20, (i) => (i === 19 ? 400 : 150)),
			{},
			FAST
		);
		expect(v.ok).toBe(true);
	});

	it('fails on heap growth', () => {
		const v = analyzeSoak(
			series(
				20,
				() => 150,
				(i) => (i < 10 ? 20 : 40) * MB
			),
			{},
			FAST
		);
		expect(v.ok).toBe(false);
		expect(v.failures.join()).toMatch(/heap grew/);
	});

	it('fails on a slow event loop', () => {
		const v = analyzeSoak(
			series(20, () => 150, undefined, 350),
			{},
			FAST
		);
		expect(v.failures.join()).toMatch(/event-loop p99 hit 350 ms/);
	});

	it('fails when the server exited or traffic saw errors, even with flat memory', () => {
		const v = analyzeSoak(
			series(20, () => 150),
			{ serverExit: 'code 1', errors: ['GET /chores -> 500'] },
			FAST
		);
		expect(v.ok).toBe(false);
		expect(v.failures).toEqual(['server exited: code 1', 'GET /chores -> 500']);
	});

	it('refuses a run too short to prove anything', () => {
		expect(
			analyzeSoak(
				series(3, () => 150),
				{},
				FAST
			).failures[0]
		).toMatch(/only 3 samples/);
		const v = analyzeSoak(
			series(8, () => 150),
			{},
			{ warmupMs: 10 * 60_000 }
		);
		expect(v.failures[0]).toMatch(/after the 600s warm-up/);
		expect(v.rss).toBeNull();
	});
});

describe('mutationScore', () => {
	const m = (...statuses: string[]) => ({ mutants: statuses.map((status) => ({ status })) });

	it('scores killed and timed-out mutants against all valid ones', () => {
		const r = mutationScore({
			files: {
				'a.ts': m('Killed', 'Killed', 'Timeout', 'Survived'),
				'b.ts': m('Killed', 'NoCoverage', 'Ignored', 'CompileError')
			}
		});
		expect(r).toMatchObject({ detected: 4, survived: 1, noCoverage: 1, valid: 6, score: 66.7 });
		expect(r.files.map((f) => [f.file, f.score])).toEqual([
			['b.ts', 50],
			['a.ts', 75]
		]);
	});

	it('has no score when nothing was mutated', () => {
		expect(mutationScore({ files: {} }).score).toBeNull();
		expect(mutationScore({ files: { 'a.ts': m('Ignored') } }).files[0].score).toBeNull();
	});
});
