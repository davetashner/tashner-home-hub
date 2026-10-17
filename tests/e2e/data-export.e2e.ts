import { expect, test } from '@playwright/test';
import { ensureHousehold, signInAsAdult } from './adult';

test.beforeAll(ensureHousehold);

test('grown-ups export all data as JSON; anonymous callers cannot', async ({ page, request }) => {
	expect((await request.get('/api/admin/export')).status()).toBe(401);
	await signInAsAdult(page, `e2e-export-adult`);
	const res = await page.request.get('/api/admin/export');
	expect(res.status()).toBe(200);
	expect(res.headers()['content-disposition']).toMatch(
		/^attachment; filename=hub-export-\d{4}-\d{2}-\d{2}\.json$/
	);
	const doc = await res.json();
	expect(Object.keys(doc).sort()).toEqual(
		['exportedAt', 'format', 'reconnect', 'schemaMigration', 'tables', 'version'].sort()
	);
	expect(doc.format).toBe('tashner-home-hub');
	expect(doc.version).toBe(1);
	expect(Object.keys(doc.tables)).toContain('members');
	expect(Object.keys(doc.tables)).not.toContain('events');
	expect(JSON.stringify(doc.tables.settings)).not.toContain('session.epoch');
});

test('importing a bad file is refused and changes nothing', async ({ page }) => {
	await signInAsAdult(page, `e2e-import-adult`);
	const bad = await page.request.post('/api/admin/import', {
		headers: { 'content-type': 'application/json' },
		data: { format: 'tashner-home-hub', version: 1, schemaMigration: { idx: 99, tag: 'x' } }
	});
	expect(bad.status()).toBe(422);
	expect((await bad.json()).error).toContain('newer Home Hub');

	await page.goto('/settings/backup');
	// Retry until the page has hydrated and the change handler is attached.
	await expect(async () => {
		await page.getByTestId('import-file').setInputFiles({
			name: 'bad.json',
			mimeType: 'application/json',
			buffer: Buffer.from('{"hello":1}')
		});
		await expect(page.getByRole('alert')).toHaveText('That file is not a Home Hub export.', {
			timeout: 500
		});
	}).toPass();
	await expect(page.getByRole('button', { name: 'Replace all data' })).toHaveCount(0);
});
