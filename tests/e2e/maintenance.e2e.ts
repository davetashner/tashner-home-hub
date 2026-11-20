import { expect, test, type Page } from '@playwright/test';
import { ensureHousehold, signInAsAdult } from './adult';
import { asWallDisplay } from './display';
import { expectTappable } from './tap';
import { gotoHydrated, reloadHydrated } from './hydrated';

// hub-6zbd: house jobs on a schedule, under Lists. Every job here is synthetic and tagged per run.

const tagFor = (info: { workerIndex: number; repeatEachIndex: number }) =>
	`job${Date.now().toString(36)}${info.workerIndex}${info.repeatEachIndex}`;

async function makeJob(page: Page, body: Record<string, unknown>): Promise<string> {
	const res = await page.request.post('/api/maintenance', { data: body });
	expect(res.status()).toBe(201);
	return ((await res.json()) as { id: string }).id;
}

async function dropJob(page: Page, id: string | null) {
	if (id === null) return;
	const res = await page.request.delete(`/api/maintenance/${id}`, { data: {}, maxRetries: 3 });
	expect(res.ok() || res.status() === 404).toBe(true);
}

async function openUpkeep(page: Page) {
	await gotoHydrated(page, '/lists');
	await page.getByTestId('maint-tab').click();
	await expect(page.getByTestId('maint-tab')).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByTestId('maint-panel')).toBeVisible();
}

const tapKeys = async (page: Page, text: string) => {
	for (const ch of text.toLowerCase())
		await page.getByTestId(ch === ' ' ? 'key-space' : `key-${ch}`).click();
};

test('wall: add a job with the keyboard, mark it done, undo, and it survives a reload @J6.7', async ({
	page,
	context
}, info) => {
	ensureHousehold();
	await asWallDisplay(context);
	const tag = tagFor(info);
	const row = () => page.getByTestId('maint-task').filter({ hasText: tag });
	await signInAsAdult(page, `e2e-maint-${info.project.name}`);
	let dones = 0;
	page.on('response', (r) => {
		if (r.url().endsWith('/done') && r.request().method() === 'POST' && r.ok()) dones++;
	});
	try {
		await openUpkeep(page);
		await expectTappable(page.getByTestId('maint-add'), 96);
		await page.getByTestId('maint-add').click();
		await page.getByTestId('maint-freq').and(page.locator('[data-months="3"]')).click();
		await expect(page.locator('[data-testid="maint-freq"][data-months="3"]')).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		await page.getByTestId('key-shift').click();
		await page.getByTestId('key-shift').click();
		await tapKeys(page, tag);
		await page.getByTestId('key-enter').click();

		// Never done and no due day yet: it waits as "As needed" style until it is.
		await expect(row()).toHaveCount(1);
		await expect(row()).toContainText('Quarterly');
		await expect(row()).toHaveAttribute('data-status', 'unscheduled');
		await expectTappable(row().getByTestId('maint-done'), 96);

		// Done: the last done day is today and the next one is three months on.
		await row().getByTestId('maint-done').click();
		await expect(row()).toContainText('Last done');
		await expect(row()).toHaveAttribute('data-status', 'later');
		await expect(row().getByTestId('maint-due')).toContainText(/^Due \w{3} \d{1,2}, \d{4}$/);

		// Undo puts it back as it was.
		await row().getByTestId('maint-undo').click();
		await expect(row()).not.toContainText('Last done');
		await expect(row()).toHaveAttribute('data-status', 'unscheduled');

		await row().getByTestId('maint-done').click();
		await expect(row()).toContainText('Last done');
		// Done, Undo, Done go out one at a time: wait for both Dones to land before reloading.
		await expect.poll(() => dones).toBe(2);
		await reloadHydrated(page);
		await page.getByTestId('maint-tab').click();
		await expect(row()).toContainText('Last done');
		await expect(row()).toHaveAttribute('data-status', 'later');
	} finally {
		const res = await page.request.get('/api/maintenance');
		const { tasks } = (await res.json()) as { tasks: { id: string; title: string }[] };
		for (const t of tasks.filter((t) => t.title.toLowerCase() === tag)) await dropJob(page, t.id);
	}
});

test('an overdue job badges the Lists menu and the Home upkeep tab, and Done clears it @J6.8', async ({
	page,
	context
}, info) => {
	ensureHousehold();
	await asWallDisplay(context);
	const tag = tagFor(info);
	await signInAsAdult(page, `e2e-maint-due-${info.project.name}`);
	let id: string | null = null;
	try {
		id = await makeJob(page, {
			title: tag,
			intervalMonths: 1,
			lastDone: '2020-01-01',
			estTime: '10 minutes'
		});
		await openUpkeep(page);
		const row = page.getByTestId('maint-task').filter({ hasText: tag });
		await expect(row).toHaveAttribute('data-status', 'overdue');
		await expect(row.getByTestId('maint-due')).toContainText('Overdue by');
		await expect(row).toContainText('Monthly · 10 minutes · Last done Jan 1, 2020');
		await expect(page.getByTestId('maint-tab-due')).toBeVisible();
		await expect(page.getByTestId('nav-badge')).toBeVisible();
		await expect(page.getByRole('link', { name: /^Lists, \d+ due$/ })).toBeVisible();

		// Overdue jobs sort first.
		await expect(page.getByTestId('maint-task').first()).toHaveAttribute('data-status', 'overdue');

		// The due chip fits its text, at 1440p and on the kiosk's 4K panel.
		for (const size of [null, { width: 3840, height: 2160 }]) {
			if (size) await page.setViewportSize(size);
			const fits = await row
				.getByTestId('maint-due')
				.evaluate((el) => el.scrollWidth <= el.clientWidth);
			expect(fits).toBe(true);
		}

		// Monthly: the next one is a month on, so "soon" or "later" depending on the month's length.
		await row.getByTestId('maint-done').click();
		await expect(row).toHaveAttribute('data-status', /^(soon|later)$/);
		await expect(row.getByTestId('maint-due')).toContainText(/^Due /);
	} finally {
		await dropJob(page, id);
	}
});

test('a grown-up on a phone edits the time and notes, then deletes a job @J6.9', async ({
	page
}, info) => {
	ensureHousehold();
	const tag = tagFor(info);
	await signInAsAdult(page, `e2e-maint-edit-${info.project.name}`);
	let id: string | null = null;
	try {
		id = await makeJob(page, { title: tag, intervalMonths: 12, nextDue: '2099-06-01' });
		await openUpkeep(page);
		const row = page.getByTestId('maint-task').filter({ hasText: tag });
		await expect(row.getByTestId('maint-due')).toHaveText('Due Jun 1, 2099');
		await row.getByTestId('maint-edit').click();
		await expect(page.getByTestId('maint-form')).toBeVisible();
		await page.getByTestId('maint-time').fill('2 hours');
		await page.getByTestId('maint-notes').fill('Ladder in the garage');
		await page.locator('[data-testid="maint-freq"][data-months="24"]').click();
		await page.getByTestId('maint-save').click();
		await expect(row).toContainText('Every 2 years · 2 hours');
		await expect(row).toContainText('Ladder in the garage');
		await reloadHydrated(page);
		await page.getByTestId('maint-tab').click();
		await expect(row).toContainText('Every 2 years · 2 hours');

		await row.getByTestId('maint-edit').click();
		await page.getByTestId('maint-delete').click();
		await page.getByTestId('maint-confirm-delete').click();
		await expect(row).toHaveCount(0);
		await expect
			.poll(async () => (await page.request.get('/api/maintenance')).text())
			.not.toContain(tag);
		id = null;
	} finally {
		await dropJob(page, id);
	}
});
