import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { expectTappable } from './tap';
import { signInAsAdult } from './adult';
import { syntheticJpeg } from '../../src/lib/server/photo-cache/fixtures';
import { gotoHydrated } from './hydrated';

test('add a folder, pick albums, scan, hide a photo', async ({ page }, info) => {
	const name = info.project.name;
	// Unique per run too (not just per project), so a leftover or concurrent source never shares the card.
	const run = `${Date.now().toString(36)}-${info.parallelIndex}-${info.repeatEachIndex}`;
	const label = `Lib ${name} ${run}`;
	// The server reads the same filesystem; data/photo-library is always an allowed root.
	const root = resolve('data', 'photo-library', `e2e-${name}-${run}`);
	rmSync(root, { recursive: true, force: true });
	for (const [dir, w, h] of [
		['Trip', 640, 360],
		['Pets', 360, 640]
	] as const) {
		mkdirSync(`${root}/${dir}`, { recursive: true });
		writeFileSync(`${root}/${dir}/a.jpg`, await syntheticJpeg(w, h));
	}
	await signInAsAdult(page, `e2e-photo-${name}`);
	// Typing before hydration lets it re-apply the default label on top of the text
	// ("Family photosLib ..."), so the card never carries the expected name.
	await gotoHydrated(page, '/settings/photo-library');

	await page.getByLabel('Name').fill(label);
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
	const card = page.getByTestId(`source-${label}`);
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

	// A yearly window: the album shows only between two days (Pets sorts first).
	const between = card.getByRole('button', { name: 'Show only between…' }).first();
	await expectTappable(between);
	await between.click();
	const dates = card.getByRole('form', { name: 'Dates for Pets' });
	await dates.getByLabel('From month').selectOption({ index: 5 });
	await dates.getByLabel('From day').selectOption('1');
	await dates.getByLabel('To month').selectOption({ index: 5 });
	await dates.getByLabel('To day').selectOption('10');
	const save = dates.getByRole('button', { name: 'Save dates' });
	await expectTappable(save);
	const saved = page.waitForResponse((r) => r.request().method() === 'PATCH');
	await save.click();
	expect((await saved).status()).toBe(200);
	await expect(card.getByTestId('album-window')).toContainText('1 –');
	await expect(card.getByTestId('album-window')).toContainText(' 10 each year');
	await card.getByRole('button', { name: 'Clear dates' }).click();
	await expect(card.getByTestId('album-window')).toHaveCount(0);

	const hide = card.getByRole('button', { name: 'Hide photo' }).first();
	await expectTappable(hide);
	await hide.click();
	await expect(card.getByRole('button', { name: 'Show photo' })).toHaveCount(1);
	await expect(card.locator('img').first()).toHaveJSProperty('complete', true);

	await card.getByRole('button', { name: 'Remove' }).click();
	await expect(card).toHaveCount(0);
});
