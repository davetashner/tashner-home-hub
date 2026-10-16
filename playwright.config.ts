import { defineConfig, devices } from '@playwright/test';

// E2E_PORT lets parallel worktrees run the suite side by side without testing each other's build.
const port = Number(process.env.E2E_PORT ?? 4173);
const baseURL = `http://127.0.0.1:${port}`;

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
		env: { HOST: '127.0.0.1', PORT: String(port) },
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
		}
	]
});
