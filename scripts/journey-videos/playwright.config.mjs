// The Playwright run behind record.mjs, never CI: the repo's own projects (devices, viewports,
// the iOS spec list) with every test recorded to a video and the overlay on (tsconfig.json maps
// '@playwright/test' to fixture.mjs). One worker, so tests run one at a time in one browser.
// record.mjs sets JV_OUT (output dir), JV_DATA_DIR (a fresh data dir) and JV_REGISTRY.
import { defineConfig } from '@playwright/test';
import base from '../../playwright.config.ts';
import { fitVideo } from './plan.mjs';

const port = Number(process.env.E2E_PORT ?? 4173);
const out = process.env.JV_OUT ?? 'reports/journeys/adhoc';

export default defineConfig({
	...base,
	tsconfig: new URL('./tsconfig.json', import.meta.url).pathname,
	testDir: '../../tests/e2e',
	workers: 1,
	fullyParallel: false,
	retries: 0,
	timeout: 90_000,
	outputDir: `${out}/artifacts`,
	reporter: [['list'], ['json', { outputFile: `${out}/report.json` }]],
	webServer: {
		...base.webServer,
		cwd: new URL('../..', import.meta.url).pathname,
		env: { HOST: '127.0.0.1', PORT: String(port), DATA_DIR: process.env.JV_DATA_DIR ?? '' }
	},
	projects: base.projects.map((p) => {
		const viewport = p.use.viewport ?? { width: 1280, height: 720 };
		return { ...p, use: { ...p.use, video: { mode: 'on', size: fitVideo(viewport) } } };
	})
});
