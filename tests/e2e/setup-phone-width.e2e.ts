import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

// hub-gap: first-run /setup only renders on an empty database, so this boots its own server on a
// throwaway DATA_DIR and checks the page never scrolls sideways on a phone or the wall.

async function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const srv = createServer();
		srv.listen(0, '127.0.0.1', () => {
			const { port } = srv.address() as { port: number };
			srv.close(() => resolve(port));
		});
		srv.on('error', reject);
	});
}

const viewports = [
	{ name: 'iPhone portrait', width: 390, height: 844 },
	{ name: 'iPhone landscape', width: 852, height: 393 },
	{ name: 'wall portrait', width: 1080, height: 1920 },
	{ name: 'wall landscape', width: 1920, height: 1080 }
];

let child: ChildProcess;
let dataDir: string;
let base: string;

test.beforeAll(async () => {
	dataDir = mkdtempSync(join(tmpdir(), 'hub-setup-'));
	const port = await freePort();
	base = `http://127.0.0.1:${port}`;
	child = spawn('node', ['build'], {
		env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), DATA_DIR: dataDir },
		stdio: 'ignore'
	});
	await expect
		.poll(
			() =>
				fetch(`${base}/healthz`).then(
					(r) => r.ok,
					() => false
				),
			{ timeout: 30_000 }
		)
		.toBe(true);
});

test.afterAll(() => {
	child?.kill();
	rmSync(dataDir, { recursive: true, force: true });
});

for (const vp of viewports) {
	test(`first-run /setup does not scroll sideways on ${vp.name} @J16.3`, async ({ page }) => {
		await page.setViewportSize({ width: vp.width, height: vp.height });
		await page.goto(`${base}/setup`);
		await expect(page.getByTestId('setup-profile')).toBeVisible();
		await page.waitForLoadState('networkidle');
		const overflow = await page.evaluate(() => ({
			page: document.documentElement.scrollWidth - window.innerWidth,
			form: (() => {
				const f = document.querySelector('[data-testid=setup-profile]')!;
				return [...f.querySelectorAll('*')].filter(
					(el) => el.getBoundingClientRect().right > window.innerWidth + 0.5
				).length;
			})()
		}));
		expect(overflow.page).toBeLessThanOrEqual(0);
		expect(overflow.form).toBe(0);
	});
}
