import { expect, test, type Page } from '@playwright/test';
import { signInAsAdult } from './adult';
import { trackMember } from './cleanup';
import { stubAudio } from './kid';
import { gotoHydrated, reloadHydrated } from './hydrated';

/** Household "today" comes from the server; step back from it with plain date math. */
function daysBefore(date: string, n: number): string {
	const d = new Date(`${date}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() - n);
	return d.toISOString().slice(0, 10);
}

async function doneOn(page: Page, choreId: string, memberId: string, date?: string) {
	const done = await (
		await page.request.post(`/api/chores/${choreId}/complete`, {
			data: date ? { memberId, date } : { memberId }
		})
	).json();
	// Habits are plain checks: no approval step, counted as soon as they are done.
	return done.completion.date as string;
}

async function streakRows(page: Page, memberId: string) {
	const { history } = await (
		await page.request.get(`/api/members/${memberId}/stars`, { maxRetries: 3 })
	).json();
	return (history as { reason: string; delta: number; status: string }[]).filter(
		(r) => r.reason === 'streak'
	);
}

// A worker runs one test at a time, so a module variable is safe. Removing the kid afterwards
// keeps the shared database (and every kid screen's refresh) small for later specs.
let seededKid: string | null = null;
test.afterEach(async ({ page }) => {
	if (seededKid)
		await page.request
			.delete(`/api/members/${seededKid}?confirm=true`, { data: {}, maxRetries: 3 })
			.catch(() => {});
	seededKid = null;
});

test('the kid sees the streak badge, then a 3-day milestone banner paid exactly once @J13.3', async ({
	page
}, info) => {
	await stubAudio(page);
	// Pin the browser's day; timers still run so the banner can come and go.
	await page.clock.setFixedTime(Date.now());
	const tag = `${info.project.name}-${info.parallelIndex}-${Date.now() % 1e9}`;
	await signInAsAdult(page, `adult-streak-${info.project.name.replace(/\W/g, '')}`);

	const member = await (
		await page.request.post('/api/members', {
			data: { name: `Streaky ${tag}`, role: 'child', color: 'member-4', avatar: '🦊' }
		})
	).json();
	trackMember(member.id);
	seededKid = member.id;
	const choreId = (
		await (
			await page.request.post('/api/chores', {
				data: {
					title: `Streak job ${tag}`,
					icon: '🛏️',
					stars: 1,
					kind: 'habit',
					timeOfDay: 'morning',
					memberIds: [member.id],
					schedule: { type: 'daily', start: '2000-01-01' },
					requiresApproval: true
				}
			})
		).json()
	).id as string;

	// Two finished days in a row (yesterday and the day before), today still open.
	const now = await (
		await page.request.get(`/api/members/${member.id}/streak`, { maxRetries: 3 })
	).json();
	expect(now.days).toBe(0);
	// Today is still open; the two past days are done (habits need no approval).
	const { timeZone } = await (await page.request.get('/api/settings/household')).json();
	const todayDate = new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
	await doneOn(page, choreId, member.id, daysBefore(todayDate, 2));
	await doneOn(page, choreId, member.id, daysBefore(todayDate, 1));

	await gotoHydrated(page, `/chores?member=${member.id}`);
	await expect(page.getByTestId('star-jar')).toBeVisible();
	const badge = page.getByTestId('streak-badge');
	await expect(badge).toContainText('2-day habit streak');
	await expect(badge).toContainText('1 more for bonus stars');
	await expect(page.getByTestId('streak-milestone')).toHaveCount(0);
	expect(await streakRows(page, member.id)).toHaveLength(0);

	// Today's habit gets checked: the run reaches 3 and the party plays.
	const today = await (
		await page.request.post(`/api/chores/${choreId}/complete`, { data: { memberId: member.id } })
	).json();
	expect(today.completion.id).toBeTruthy();
	// The kid screen re-reads on focus; nudge it until the refresh lands (one may be in flight).
	const banner = page.getByTestId('streak-milestone');
	await expect(async () => {
		await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
		await expect(banner).toBeVisible({ timeout: 6000 });
	}).toPass();

	await expect(banner).toContainText('3-day habit streak');
	await expect(banner).toContainText('+2 bonus stars');
	await expect(badge).toContainText('3-day habit streak');

	// Exactly one payout, and reloading or approving again never pays twice.
	let rows = await streakRows(page, member.id);
	expect(rows).toHaveLength(1);
	expect(rows[0]).toMatchObject({ delta: 2, status: 'approved' });
	await reloadHydrated(page);
	await expect(page.getByTestId('star-jar')).toBeVisible();
	await expect(page.getByTestId('streak-badge')).toContainText('3-day habit streak');
	await expect(page.getByTestId('streak-milestone')).toHaveCount(0);
	// A repeated tap is harmless; retries cover idle keep-alive sockets the server closed.
	await page.request.post(`/api/chores/${choreId}/complete`, {
		data: { memberId: member.id },
		maxRetries: 3
	});
	rows = await streakRows(page, member.id);
	expect(rows).toHaveLength(1);
	const { balance } = await (
		await page.request.get(`/api/members/${member.id}/stars`, { maxRetries: 3 })
	).json();
	expect(balance).toBe(3 + 2); // three chores at 1 star plus the milestone
});
