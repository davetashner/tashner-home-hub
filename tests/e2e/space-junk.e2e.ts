import { expect, test, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { ensureHousehold, signInAsAdult } from './adult';
import { trackMember } from './cleanup';
import { DB_PATH } from './data-dir';
import { expectTappable } from './tap';
import { gotoHydrated } from './hydrated';

test.beforeAll(ensureHousehold);

const DAY = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * A synthetic kid whose daily job "Dishes" was created 4 days ago and never done, so the last few
 * days were missed. The judging baseline is moved back so those days count.
 */
async function seedMissed(page: Page, label: string) {
	await signInAsAdult(page, `adult-fun-${label.replace(/\W/g, '')}`);
	const request = page.request;
	const member = await (
		await request.post('/api/members', {
			data: { name: `Mira ${Date.now() % 1e9}`, role: 'child', color: 'member-2', avatar: '🦊' }
		})
	).json();
	trackMember(member.id);
	const chore = await (
		await request.post('/api/chores', {
			data: {
				title: 'Dishes',
				icon: '🍽️',
				stars: 2,
				memberIds: [member.id],
				requiresApproval: false,
				schedule: { type: 'daily', start: isoDay(Date.now() - 5 * DAY) }
			}
		})
	).json();
	const db = new Database(DB_PATH);
	db.pragma('busy_timeout = 5000');
	db.prepare('UPDATE chores SET created_at = ? WHERE id = ?').run(Date.now() - 4 * DAY, chore.id);
	db.prepare(
		`INSERT INTO settings (key, value) VALUES ('missed_jobs_since', ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value`
	).run(JSON.stringify(isoDay(Date.now() - 6 * DAY)));
	db.close();
	return {
		memberId: member.id as string,
		choreId: chore.id as string,
		name: member.name as string
	};
}

test('Games tab opens Space Junk: pick level 1, fire, restart, back to levels @J14.4', async ({
	page
}) => {
	await gotoHydrated(page, '/games');
	const tile = page.getByTestId('space-junk-tile');
	await expectTappable(tile, 96);
	await tile.click();
	await expect(page.getByRole('heading', { name: 'Space Junk' })).toBeVisible();
	const levels = page.getByTestId('sj-level');
	await expect(levels).toHaveCount(10);
	await expect(levels.nth(1)).toBeDisabled();
	await expectTappable(levels.first(), 96);
	await levels.first().click();

	const canvas = page.getByTestId('space-junk-canvas');
	await expect(canvas).toHaveAttribute('data-phase', 'aiming');
	// The engine loads lazily: the count is 0 until it is ready.
	await expect(canvas).not.toHaveAttribute('data-junkbots', '0');
	const total = Number(await canvas.getAttribute('data-junkbots'));
	for (const id of ['sj-pause', 'sj-restart', 'sj-back'])
		await expectTappable(page.getByTestId(id), 96);

	const box = (await canvas.boundingBox())!;
	const ax = box.x + Number(await canvas.getAttribute('data-anchor-x'));
	const ay = box.y + Number(await canvas.getAttribute('data-anchor-y'));
	await page.mouse.move(ax, ay);
	await page.mouse.down();
	await page.mouse.move(ax - 60, ay + 30, { steps: 5 });
	await page.mouse.up();
	await expect(canvas).toHaveAttribute('data-junkbots', String(total - 1));

	await page.getByTestId('sj-restart').click();
	await expect(canvas).toHaveAttribute('data-junkbots', String(total));
	await page.getByTestId('sj-back').click();
	await expect(page.getByTestId('sj-game')).toBeHidden();
	await expect(levels.first()).toBeVisible();
});

test('a stored win unlocks the next level; an used-up level shows the end card @J14.5', async ({
	page
}) => {
	test.setTimeout(120_000);
	await gotoHydrated(page, '/games/space-junk');
	await page.evaluate(() => {
		// Level 1 already won with two stars on this device.
		localStorage.setItem('hub.space-junk.progress.device', JSON.stringify({ 'junk-1': 2 }));
	});
	await gotoHydrated(page, '/games/space-junk');
	await expect(page.getByTestId('sj-level').nth(1)).toBeEnabled();
	await expect(page.getByTestId('sj-level').first()).toContainText('★★☆');
	await page.getByTestId('sj-level').nth(1).click();
	await expect(page.getByTestId('space-junk-canvas')).toHaveAttribute('data-phase', 'aiming');
	await page.getByTestId('sj-pause').click();
	await expect(page.getByTestId('sj-menu')).toBeVisible();
	await page.getByTestId('sj-resume').click();
	await expect(page.getByTestId('sj-menu')).toBeHidden();

	// Spend every Junkbot on shots straight into the ground: the level is lost.
	const canvas = page.getByTestId('space-junk-canvas');
	await expect(canvas).not.toHaveAttribute('data-junkbots', '0');
	const box = (await canvas.boundingBox())!;
	const ax = box.x + Number(await canvas.getAttribute('data-anchor-x'));
	const ay = box.y + Number(await canvas.getAttribute('data-anchor-y'));
	for (let n = Number(await canvas.getAttribute('data-junkbots')); n > 0; n--) {
		await expect(canvas).toHaveAttribute('data-phase', 'aiming', { timeout: 20_000 });
		await page.mouse.move(ax, ay);
		await page.mouse.down();
		await page.mouse.move(ax - 20, ay - 60, { steps: 3 });
		await page.mouse.up();
		await expect(canvas).toHaveAttribute('data-junkbots', String(n - 1));
	}
	const end = page.getByTestId('sj-end');
	await expect(end).toBeVisible({ timeout: 30_000 });
	await expectTappable(page.getByTestId('sj-retry'), 96);
	await expectTappable(page.getByTestId('sj-levels-btn'), 96);
	await page.getByTestId('sj-retry').click();
	await expect(end).toBeHidden();
	await expect(canvas).toHaveAttribute('data-phase', 'aiming');
});

test('Space Junk is locked while Games is locked @J14.6', async ({ page }, info) => {
	const kid = await seedMissed(page, info.project.name);
	await page.goto(`/games/space-junk?member=${kid.memberId}`);
	await expect(page.getByTestId('fun-locked')).toBeVisible();
	await expect(page.getByTestId('sj-level')).toHaveCount(0);
	await expect(page.getByTestId('sj-game')).toHaveCount(0);
});
