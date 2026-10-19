import { expect, test } from '@playwright/test';
import { signInAsAdult } from './adult';
import { gotoHydrated } from './hydrated';
import { holdSitter } from './sitter-lock';

const tag = (name: string) => name.replace(/\W/g, '');

test('Sitter mode: a late card load does not overwrite what the adult typed @J19.5', async ({
	page
}, info) => {
	test.setTimeout(60_000);
	const release = await holdSitter();
	try {
		await signInAsAdult(page, `e2e-sitter-late-${tag(info.project.name)}`);
		let open!: () => void;
		const gate = new Promise<void>((r) => (open = r));
		let held = 0;
		await page.route('**/api/sitter/card', async (route) => {
			if (route.request().method() !== 'GET') return route.fallback();
			held++;
			await gate;
			await route.fulfill({
				json: {
					contacts: [],
					address: 'Stored Address',
					kids: [],
					rules: ['Stored rule'],
					wifiName: 'StoredNet',
					wifiPassword: '',
					tonight: 'Stored plan',
					pets: [],
					vet: { name: '', phone: '' },
					petER: { name: '', phone: '' }
				}
			});
		});
		await gotoHydrated(page, '/settings/sitter-mode');
		await expect.poll(() => held).toBeGreaterThan(0);
		await page.getByTestId('sitter-address').fill('9 Typed Lane');
		await page.getByTestId('sitter-rules').fill('Typed rule one\nTyped rule two');
		await page.getByTestId('sitter-wifi').fill('TypedNet');
		await page.getByTestId('sitter-tonight').fill('Typed plan');
		open();
		// Let the held load land and settle.
		await page.waitForTimeout(500);
		await expect(page.getByTestId('sitter-address')).toHaveValue('9 Typed Lane');
		await expect(page.getByTestId('sitter-rules')).toHaveValue('Typed rule one\nTyped rule two');
		await expect(page.getByTestId('sitter-wifi')).toHaveValue('TypedNet');
		await expect(page.getByTestId('sitter-tonight')).toHaveValue('Typed plan');
	} finally {
		release();
	}
});

test('Sitter mode: starting a session while editing the card keeps the edits @J19.6', async ({
	page
}, info) => {
	test.setTimeout(60_000);
	const release = await holdSitter();
	try {
		const t = tag(info.project.name);
		await signInAsAdult(page, `e2e-sitter-edit-${t}`);
		await gotoHydrated(page, '/settings/sitter-mode');
		await page.getByTestId('sitter-address').fill(`7 Unsaved Road ${t}`);
		await page.getByTestId('sitter-rules').fill('Unsaved rule');
		await page.getByTestId('sitter-add-contact').click();
		await page.getByTestId('sitter-contact').last().getByLabel('Contact name').fill('Parent One');

		const end = new Date(Date.now() + 2 * 3_600_000);
		const p = (n: number) => String(n).padStart(2, '0');
		await page.getByTestId('sitter-name').fill(`Sam Sitter ${t}`);
		await page
			.getByTestId('sitter-endat')
			.fill(
				`${end.getFullYear()}-${p(end.getMonth() + 1)}-${p(end.getDate())}T${p(end.getHours())}:${p(end.getMinutes())}`
			);
		const reload = page.waitForResponse(
			(r) => r.url().endsWith('/api/sitter/card') && r.request().method() === 'GET'
		);
		await page.getByTestId('sitter-start-btn').click();
		const row = page.getByTestId('sitter-session-row').filter({ hasText: `Sam Sitter ${t}` });
		await expect(row.getByTestId('sitter-status')).toContainText('Active');
		await reload;
		await page.waitForTimeout(300);

		await expect(page.getByTestId('sitter-address')).toHaveValue(`7 Unsaved Road ${t}`);
		await expect(page.getByTestId('sitter-rules')).toHaveValue('Unsaved rule');
		await expect(page.getByTestId('sitter-contact').last().getByLabel('Contact name')).toHaveValue(
			'Parent One'
		);

		await row.getByTestId('sitter-end').click();
		await expect(row).toHaveCount(0);
	} finally {
		release();
	}
});
