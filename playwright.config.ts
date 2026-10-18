import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// E2E_PORT lets parallel worktrees run the suite side by side without testing each other's build.
const port = Number(process.env.E2E_PORT ?? 4173);
const baseURL = `http://127.0.0.1:${port}`;

// A fresh data dir per run under .e2e-data/<port>/, never the dev data/. Workers re-load this
// file with TEST_WORKER_INDEX set, so only the main process wipes it. Specs read E2E_DATA_DIR.
const dataDir = resolve(`.e2e-data/${port}`);
if (process.env.TEST_WORKER_INDEX === undefined) {
	rmSync(dataDir, { recursive: true, force: true });
	mkdirSync(dataDir, { recursive: true });
}
process.env.E2E_DATA_DIR = dataDir;

// Flows people use from an iPhone or iPad. Specs that need Chromium-only APIs (CDP) stay out.
// WebKit keeps the service worker on under automation, and page.route can't see requests it
// handles, so these projects block it (offline.e2e covers the worker in Chromium).
const IOS_SPECS = [
	'**/critical-flows.e2e.ts',
	'**/display-role.e2e.ts',
	'**/home-screen.e2e.ts',
	'**/ios-input-zoom.e2e.ts',
	'**/phone-admin.e2e.ts'
];

export default defineConfig({
	testDir: 'tests/e2e',
	testMatch: '**/*.e2e.ts',
	forbidOnly: !!process.env.CI,
	retries: 0,
	timeout: 30_000,
	reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
	// Runs the production server directly (one process, so shutdown is clean).
	// `pnpm test:e2e` builds first.
	webServer: {
		command: 'node build',
		env: { HOST: '127.0.0.1', PORT: String(port), DATA_DIR: dataDir },
		url: `${baseURL}/healthz`,
		// Never reuse: a server left on the port may be another checkout's build.
		reuseExistingServer: false,
		timeout: 60_000
	},
	use: { baseURL },
	projects: [
		{
			name: 'wall-landscape-1440p',
			use: { ...devices['Desktop Chrome'], viewport: { width: 2560, height: 1440 } }
		},
		{
			name: 'wall-portrait-1440p',
			use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 2560 } }
		},
		// DEV-5: every iOS browser is WebKit, so the phone and tablet flows also run there.
		{
			name: 'iphone-webkit',
			testMatch: IOS_SPECS,
			use: { ...devices['iPhone 15'], serviceWorkers: 'block' }
		},
		{
			name: 'ipad-portrait-webkit',
			testMatch: IOS_SPECS,
			use: { ...devices['iPad Pro 11'], serviceWorkers: 'block' }
		},
		{
			name: 'ipad-landscape-webkit',
			testMatch: IOS_SPECS,
			use: { ...devices['iPad Pro 11 landscape'], serviceWorkers: 'block' }
		}
	]
});
