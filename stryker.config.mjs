// Mutation testing for the domain modules only (ADR 0002 Tier 3). Run nightly on tower by
// .github/workflows/tower-nightly.yml; advisory until the score is known. Run locally with
//   pnpm exec stryker run --mutate src/lib/domain/clock.ts
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
	testRunner: 'vitest',
	plugins: ['@stryker-mutator/vitest-runner'],
	vitest: { configFile: 'vite.config.ts', dir: '.', related: true },
	mutate: [
		'src/lib/domain/**/*.ts',
		'src/lib/server/domain/**/*.ts',
		'!src/lib/**/*.{spec,test}.ts'
	],
	coverageAnalysis: 'perTest',
	incremental: true,
	incrementalFile: process.env.STRYKER_INCREMENTAL_FILE ?? '.stryker-tmp/incremental.json',
	reporters: ['clear-text', 'progress', 'json', 'html'],
	jsonReporter: { fileName: 'reports/mutation/mutation.json' },
	htmlReporter: { fileName: 'reports/mutation/index.html' },
	tempDirName: '.stryker-tmp/sandbox',
	cleanTempDir: true,
	// Advisory first: report the score, never fail the job on it. Proposed gate: break at 70.
	thresholds: { high: 80, low: 70, break: null },
	ignoreStatic: true,
	concurrency: 4, // leave headroom on the shared runner
	timeoutMS: 20_000
};
