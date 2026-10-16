import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { expectTappable } from './tap';
import { signInAsAdult } from './adult';
import { syntheticJpeg } from '../../src/lib/server/photo-cache/fixtures';

test('add a folder, pick albums, scan, hide a photo', async ({ page }, info) => {
	const name = info.project.name;
	// The server reads the same filesystem; data/photo-library is always an allowed root.
	const root = resolve('data', 'photo-library', `e2e-${name}`);
	rmSync(root, { recursive: true, force: true });
	for (const [dir, w, h] of [
		['Trip', 640, 360],
		['Pets', 360, 640]
	] as const) {
		mkdirSync(`${root}/${dir}`, { recursive: true });
		writeFileSync(`${root}/${dir}/a.jpg`, await syntheticJpeg(w, h));
	}
	await signInAsAdult(page, `e2e-photo-${name}`);
	await page.goto('/settings/photo-library');

	await page.getByLabel('Name').fill(`Lib ${name}`);
	await page.getByLabel('Folder path').fill('/etc');
	const add = page.getByRole('button', { name: 'Add folder' });
	await expectTappable(add);
	await add.click();
	await expect(page.getByRole('alert')).toContainText('outside the allowed');

	await page.getByLabel('Folder path').fill(root);
	// Wait on the add itself, so a slow or failed request is reported as that, not as a missing card.
	const added = page.waitForResponse(
		(r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/photo-sources',
		{ timeout: 5_000 }
	);
	await add.click();
	expect((await added).status()).toBe(201);
	const card = page.getByTestId(`source-Lib ${name}`);
	await expect(card.getByTestId('scan-status')).toContainText('2 photos');
	await expect(card.getByText('Trip')).toBeVisible();

	const scanNow = card.getByRole('button', { name: 'Scan now' });
	await expectTappable(scanNow);
	await scanNow.click();
	// "scanned" is already on screen from the first scan: wait for this one to finish instead.
	await expect(scanNow).toHaveText('Scan now');
	await expect(scanNow).toBeEnabled();
	await expect(card.getByTestId('scan-status')).toContainText('scanned');

	await card.getByRole('checkbox').first().uncheck();
	await expect(card.getByRole('checkbox').first()).not.toBeChecked();

	const hide = card.getByRole('button', { name: 'Hide photo' }).first();
	await expectTappable(hide);
	await hide.click();
	await expect(card.getByRole('button', { name: 'Show photo' })).toHaveCount(1);
	await expect(card.locator('img').first()).toHaveJSProperty('complete', true);

	await card.getByRole('button', { name: 'Remove' }).click();
	await expect(card).toHaveCount(0);
});
