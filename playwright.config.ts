import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://127.0.0.1:4173';

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
		env: { HOST: '127.0.0.1', PORT: '4173' },
		url: `${baseURL}/healthz`,
		reuseExistingServer: !process.env.CI,
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
		}
	]
});
