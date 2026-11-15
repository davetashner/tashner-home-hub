import { expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { ensureHousehold, signInAsAdult } from './adult';
import { gotoHydrated } from './hydrated';
import { expectTappable } from './tap';
import { trackMember } from './cleanup';
import { DB_PATH } from './data-dir';

// hub-t27j.11: a grown-up sets a drawing challenge for one kid; it replaces the daily prompt on the
// board until Done or a post by that kid. The challenge list is shared household state and both wall
// projects run at once, so the board test feeds it through a route (a real challenge for a synthetic
// kid would hide the daily prompt on every other test's board); the real API is tested separately.

function seedKid(id: string, name: string) {
	ensureHousehold();
	const db = new Database(DB_PATH);
	db.pragma('busy_timeout = 5000');
	db.prepare(
		"INSERT OR REPLACE INTO members (id, name, role, color, avatar) VALUES (?, ?, 'child', 'member-3', '🦊')"
	).run(id, name);
	db.close();
	trackMember(id);
}

test('a grown-up sets a challenge in Settings and can remove it @J18.33', async ({
	page
}, info) => {
	const kidId = `e2e-chal-kid-${info.workerIndex}${info.repeatEachIndex}`;
	const name = `Kid Chal${info.workerIndex}${info.repeatEachIndex}`;
	seedKid(kidId, name);
	// The API is mocked (a real challenge, even briefly, would hide the daily prompt on a parallel
	// test's board); the real API is covered by its own unit spec.
	let stored: { id: string; memberId: string; text: string }[] = [];
	const sent: { method: string; body: Record<string, string> }[] = [];
	await page.route('**/api/settings/drawing-challenges', async (route) => {
		const method = route.request().method();
		if (method === 'GET') return route.fulfill({ json: stored });
		const body = route.request().postDataJSON() as Record<string, string>;
		sent.push({ method, body });
		if (method === 'POST') {
			const made = { id: 'c1', memberId: body.memberId, text: body.text };
			stored = [made];
			return route.fulfill({ status: 201, json: made });
		}
		stored = stored.filter((c) => c.id !== body.id);
		return route.fulfill({ json: stored });
	});
	await signInAsAdult(page, 'e2e-baseline-adult');
	await gotoHydrated(page, '/settings/drawing');
	await page.getByTestId('challenge-kid').selectOption({ label: name });
	await page.getByTestId('challenge-text').fill('Draw what you want for dinner Friday');
	await expectTappable(page.getByTestId('challenge-add'), 60);
	await page.getByTestId('challenge-add').click();
	const row = page.getByTestId('challenge-row').filter({ hasText: name });
	await expect(row).toContainText('Draw what you want for dinner Friday');
	expect(sent).toEqual([
		{ method: 'POST', body: { memberId: kidId, text: 'Draw what you want for dinner Friday' } }
	]);
	await row.getByTestId('challenge-remove').click();
	await expect(row).toHaveCount(0);
	expect(sent.at(-1)).toEqual({ method: 'DELETE', body: { id: 'c1' } });
});

test('the board shows the challenge instead of the daily prompt; Done and posting clear it @J18.33', async ({
	page
}, info) => {
	const doneId = `e2e-chal-a-${info.workerIndex}${info.repeatEachIndex}`;
	const postId = `e2e-chal-b-${info.workerIndex}${info.repeatEachIndex}`;
	const doneName = `Kid Done${info.workerIndex}${info.repeatEachIndex}`;
	const postName = `Kid Post${info.workerIndex}${info.repeatEachIndex}`;
	seedKid(doneId, doneName);
	seedKid(postId, postName);
	let challenges = [
		{ id: 'c-done', memberId: doneId, text: 'Draw your favorite pizza' },
		{ id: 'c-post', memberId: postId, text: 'Draw what you want for dinner Friday' }
	];
	const cleared: unknown[] = [];
	await page.route('**/api/settings/drawing-challenges', (route) =>
		route.fulfill({ json: challenges })
	);
	await page.route('**/api/settings/drawing-challenges/done', async (route) => {
		const body = route.request().postDataJSON() as { id?: string; memberId?: string };
		cleared.push(body);
		challenges = challenges.filter((c) => c.id !== body.id && c.memberId !== body.memberId);
		await route.fulfill({ json: challenges });
	});
	await page.route('**/api/settings/drawing-prompts', (route) =>
		route.fulfill({ json: { enabled: true, date: '2026-10-31' } })
	);
	await gotoHydrated(page, '/');
	await page.getByTestId('note-draw').click();

	// Each kid's challenge shows with their name, and the daily prompt steps aside.
	const banners = page.getByTestId('draw-challenge');
	await expect(banners).toHaveCount(2);
	await expect(banners.filter({ hasText: doneName })).toContainText('Draw your favorite pizza');
	await expect(page.getByTestId('draw-prompt-banner')).toHaveCount(0);
	await expectTappable(page.getByTestId('draw-challenge-done').first(), 96);
	await expectTappable(page.getByTestId('draw-challenge-later').first(), 96);

	// It fits at the 4K monitor's scale 1 as well as the wall viewport.
	const wall = page.viewportSize();
	for (const size of [wall, { width: 3840, height: 2160 }]) {
		if (size) await page.setViewportSize(size);
		for (const b of await banners.all())
			expect(await b.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
	}
	if (wall) await page.setViewportSize(wall);

	// Done clears that one.
	await banners.filter({ hasText: doneName }).getByTestId('draw-challenge-done').click();
	await expect(banners).toHaveCount(1);
	expect(cleared).toEqual([{ id: 'c-done' }]);

	// Later hides it for this visit only: the daily prompt returns, and reopening brings it back.
	await page.getByTestId('draw-challenge-later').click();
	await expect(banners).toHaveCount(0);
	await expect(page.getByTestId('draw-prompt-banner')).toBeVisible();
	await page.getByTestId('draw-close').click();
	await page.getByTestId('note-draw').click();
	await expect(banners).toHaveCount(1);

	// Posting as that kid completes it.
	await page.getByTestId('draw-canvas').evaluate((c) => {
		const r = c.getBoundingClientRect();
		const fire = (name: string, x: number, y: number) =>
			c.dispatchEvent(
				new PointerEvent(name, {
					pointerId: 1,
					pointerType: 'touch',
					pressure: 0.5,
					isPrimary: true,
					bubbles: true,
					clientX: r.left + r.width * x,
					clientY: r.top + r.height * y
				})
			);
		fire('pointerdown', 0.2, 0.3);
		fire('pointermove', 0.5, 0.4);
		fire('pointerup', 0.7, 0.5);
	});
	await expect(page.getByTestId('draw-canvas')).toHaveAttribute('data-strokes', '1');
	await page.getByTestId('draw-post').click();
	await page.getByTestId('draw-author').filter({ hasText: postName }).click();
	await expect(page.getByTestId('draw-sheet')).toHaveCount(0);
	expect(cleared).toContainEqual({ memberId: postId });
	expect(challenges).toEqual([]);

	const db = new Database(DB_PATH);
	db.pragma('busy_timeout = 5000');
	db.prepare('DELETE FROM notes WHERE author_id IN (?, ?)').run(doneId, postId);
	db.close();
});
