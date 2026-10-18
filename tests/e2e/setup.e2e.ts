import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { expectTappable } from './tap';
import { gotoHydrated } from './hydrated';

// First-run needs an EMPTY database, which the shared server (and its seeded adults) can never be.
// So each project boots its own production server on a private port with a throwaway DATA_DIR.
test.describe.configure({ mode: 'serial' });

const PORTS: Record<string, number> = { 'wall-landscape-1440p': 4180, 'wall-portrait-1440p': 4181 };
let server: ChildProcess | undefined;
let dataDir = '';
let baseURL = '';

test.beforeAll(async () => {
	const info = test.info();
	const port = PORTS[info.project.name] ?? 4182;
	baseURL = `http://127.0.0.1:${port}`;
	dataDir = mkdtempSync(join(tmpdir(), 'hub-e2e-setup-'));
	server = spawn('node', ['build'], {
		env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), DATA_DIR: dataDir },
		stdio: 'ignore'
	});
	for (let i = 0; i < 100; i++) {
		try {
			if ((await fetch(`${baseURL}/healthz`)).ok) return;
		} catch {
			/* not up yet */
		}
		await new Promise((r) => setTimeout(r, 300));
	}
	throw new Error('setup test server did not start');
});

test.afterAll(() => {
	server?.kill();
	if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

test.use({ baseURL: undefined });

async function pad(page: import('@playwright/test').Page, pin: string) {
	for (const d of pin) await page.getByRole('button', { name: d, exact: true }).click();
	await page.getByRole('button', { name: 'Enter PIN' }).click();
}

test('fresh hub: setup, session, then guards', async ({ page }) => {
	const url = (path: string) => `${baseURL}${path}`;

	await gotoHydrated(page, url('/'));
	await expect(page).toHaveURL(/\/setup$/);
	await expect(page.getByRole('heading', { name: 'Welcome to your hub' })).toBeVisible();

	// Step 1: profile (synthetic name only).
	await expectTappable(page.getByRole('button', { name: 'Next' }));
	await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled();
	await page.getByLabel('Your name').fill('Test Parent');
	await page.getByLabel('Color 3').check({ force: true });
	await page.getByText('🦊').click();
	await page.getByRole('button', { name: 'Next' }).click();

	// Step 2: a weak PIN is rejected by the server, and we land back on step 2 with the reason.
	await expect(page.getByRole('heading', { name: 'Choose a PIN' })).toBeVisible();
	await pad(page, '1234');
	await pad(page, '1234');
	await expect(page.getByTestId('setup-notice')).toContainText('too easy');

	// Mismatched confirmation.
	await pad(page, '4817');
	await pad(page, '4818');
	await expect(page.getByTestId('setup-notice')).toContainText('did not match');

	// Matching PINs finish setup.
	for (const key of await page.locator('[data-testid="pinpad"] button').all()) {
		await expectTappable(key, 96);
	}
	await pad(page, '4817');
	await expect(page.getByRole('heading', { name: 'Type it once more' })).toBeVisible();
	await pad(page, '4817');
	await expect(page).toHaveURL(/\/settings\/family$/);
	await expect(page.getByText('Test Parent').first()).toBeVisible();

	// Setup is closed for good.
	await gotoHydrated(page, url('/setup'));
	await expect(page).toHaveURL(url('/'));
	expect(
		(
			await page.request.post(url('/api/setup'), {
				data: { name: 'X', color: 'member-1', pin: '4817' }
			})
		).status()
	).toBe(409);

	// Signed out, settings ask for the PIN and come back after.
	const out = await page.request.post(url('/api/auth/logout'), { data: {} });
	expect(out.ok()).toBe(true);
	await gotoHydrated(page, url('/settings'));
	await expect(page).toHaveURL(/\/unlock\?next=%2Fsettings$/);
	await pad(page, '4817');
	await expect(page).toHaveURL(url('/settings'));
});
