import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { signInAsAdult } from './adult';
import { gotoHydrated } from './hydrated';
import { holdSitter } from './sitter-lock';

const local = (ms: number) => {
	const d = new Date(ms);
	const p = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

async function journey(page: Page, info: TestInfo, tag: string) {
	const release = await holdSitter();
	try {
		await signInAsAdult(page, `adult-checkin-${tag}`);
		const name = `Casey Checkin ${tag}`;
		const row = page.getByTestId('sitter-session-row').filter({ hasText: name });
		const current = async () =>
			(await (await page.request.get('/api/sitter/current')).json()).session;
		await gotoHydrated(page, '/settings/sitter-mode');

		await test.step('J19.6 a parent starts a session from the phone', async () => {
			await page.getByTestId('sitter-name').fill(name);
			await page.getByTestId('sitter-endat').fill(local(Date.now() + 2 * 3_600_000));
			await page.getByTestId('sitter-start-btn').click();
			await expect(row.getByTestId('sitter-status')).toContainText('Active');
		});

		await test.step('J19.6 one-tap +30 min and +1 h', async () => {
			const before = (await current()).endAt;
			await row.getByTestId('sitter-extend-30').click();
			await expect.poll(async () => (await current()).endAt).toBe(before + 1_800_000);
			await row.getByTestId('sitter-extend').click();
			await expect.poll(async () => (await current()).endAt).toBe(before + 5_400_000);
		});

		await test.step('J19.6 the sitter checks in without an adult session; repeats are rate limited', async () => {
			const anon = await page
				.context()
				.browser()!
				.newContext({ baseURL: info.project.use.baseURL });
			const res = await anon.request.post('/api/sitter/checkin', { data: { kind: 'in-bed' } });
			expect(res.status()).toBe(200);
			expect(await res.json()).toEqual({ ok: true, at: expect.any(Number) });
			expect(
				(await anon.request.post('/api/sitter/checkin', { data: { kind: 'in-bed' } })).status()
			).toBe(429);
			expect(
				(await anon.request.post('/api/sitter/checkin', { data: { kind: 'call-me' } })).status()
			).toBe(200);
			expect(
				(await anon.request.post('/api/sitter/checkin', { data: { kind: 'nope' } })).status()
			).toBe(400);
			await anon.close();
		});

		await test.step('J19.6 end now, then check-ins are refused', async () => {
			await row.getByTestId('sitter-end').click();
			await expect(row).toHaveCount(0);
			const res = await page.request.post('/api/sitter/checkin', { data: { kind: 'all-good' } });
			expect(res.status()).toBe(409);
		});

		await test.step('J19.7 the session log lists the check-ins with their times', async () => {
			await gotoHydrated(page, '/settings/sitter-mode');
			const entry = page.getByTestId('sitter-log-entry').filter({ hasText: name });
			await expect(entry).toHaveCount(1);
			await expect(entry.getByTestId('sitter-log-checkin')).toHaveCount(2);
			await expect(entry).toContainText('Kids in bed');
			await expect(entry).toContainText('Call me');
		});
	} finally {
		release();
	}
}

const project = (info: TestInfo) => info.project.name.replace(/\W/g, '');

test('a parent runs a sitter session and reads the log', async ({ page }, info) => {
	test.setTimeout(120_000);
	await journey(page, info, project(info));
});

test.describe('on a phone', () => {
	test.use({ viewport: { width: 390, height: 844 } });
	test('a parent runs a sitter session and reads the log', async ({ page }, info) => {
		test.setTimeout(120_000);
		await journey(page, info, `phone-${project(info)}`);
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
		).toBe(true);
	});
});
