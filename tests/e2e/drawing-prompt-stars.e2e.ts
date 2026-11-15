import { expect, test, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { ensureHousehold, signInAsAdult } from './adult';
import { gotoHydrated } from './hydrated';
import { expectTappable } from './tap';
import { trackMember } from './cleanup';
import { DB_PATH } from './data-dir';

// hub-t27j.8: posting a drawing made from the daily prompt earns the artist one star a day, shows a
// streak, and a grown-up can turn it off in Settings > Drawing.

const PROMPT_DATE = '2026-10-31';

function db<T>(fn: (d: Database.Database) => T): T {
	const d = new Database(DB_PATH);
	d.pragma('busy_timeout = 5000');
	try {
		return fn(d);
	} finally {
		d.close();
	}
}

function seedKid(id: string, name: string) {
	ensureHousehold();
	db((d) =>
		d
			.prepare(
				"INSERT OR REPLACE INTO members (id, name, role, color, avatar) VALUES (?, ?, 'child', 'member-3', '🦊')"
			)
			.run(id, name)
	);
	trackMember(id);
}

const setStars = (enabled: boolean | null) =>
	db((d) => {
		d.prepare("DELETE FROM settings WHERE key = 'drawing.stars'").run();
		if (enabled === false)
			d.prepare("INSERT INTO settings (key, value) VALUES ('drawing.stars', 'false')").run();
	});

const drawingStars = (kidId: string) =>
	db(
		(d) =>
			d
				.prepare(
					"SELECT delta, status FROM star_transactions WHERE member_id = ? AND reason = 'drawing'"
				)
				.all(kidId) as { delta: number; status: string }[]
	);

async function mockPrompt(page: Page, enabled = true) {
	await page.route('**/api/settings/drawing-prompts', (route) =>
		route.fulfill({ json: { enabled, date: PROMPT_DATE } })
	);
}

async function stroke(page: Page) {
	await page.getByTestId('draw-canvas').evaluate((c) => {
		const r = c.getBoundingClientRect();
		const fire = (name: string, x: number, y: number) =>
			c.dispatchEvent(
				new PointerEvent(name, {
					pointerId: 1,
					pointerType: 'pen',
					pressure: 1,
					isPrimary: true,
					button: 0,
					buttons: name === 'pointerup' ? 0 : 1,
					clientX: r.left + x * r.width,
					clientY: r.top + y * r.height,
					bubbles: true
				})
			);
		fire('pointerdown', 0.2, 0.3);
		for (let i = 1; i <= 8; i++) fire('pointermove', 0.2 + 0.06 * i, 0.3 + 0.02 * i);
		fire('pointerup', 0.68, 0.46);
	});
}

async function openBoard(page: Page) {
	await gotoHydrated(page, '/');
	await page.getByTestId('note-draw').click();
	await expect(page.getByTestId('draw-canvas')).toBeVisible();
}

async function postAs(page: Page, name: string) {
	await stroke(page);
	await page.getByTestId('draw-post').click();
	await page.getByTestId('draw-author').filter({ hasText: name }).click();
	await expect(page.getByTestId('draw-sheet')).toHaveCount(0);
}

test('a prompt drawing earns one star a day and shows the streak @J18.21', async ({
	page
}, info) => {
	const tag = `s${Date.now().toString(36)}${info.workerIndex}${info.repeatEachIndex}`;
	const kidId = `e2e-star-kid-${tag}`;
	const kidName = `Kid ${tag}`;
	seedKid(kidId, kidName);
	setStars(null);
	await mockPrompt(page);
	try {
		await openBoard(page);
		await expect(page.getByTestId('draw-prompt')).toBeVisible();

		// Undo takes ink back and a fresh stroke still posts.
		await stroke(page);
		await page.getByTestId('draw-undo').click();
		await expect(page.getByTestId('draw-canvas')).toHaveAttribute('data-strokes', '0');
		await stroke(page);
		await page.getByTestId('draw-post').click();
		const mine = page.getByTestId('draw-author').filter({ hasText: kidName });
		await expect(mine.getByTestId('draw-author-hint')).toHaveText('+1 star');
		await expectTappable(mine, 96);

		// Fits at 4K scale 1: the picker stays inside the sheet.
		await page.setViewportSize({ width: 3840, height: 2160 });
		const box = await mine.boundingBox();
		const sheet = await page.getByTestId('draw-sheet').boundingBox();
		expect(box && sheet && box.x >= sheet.x && box.x + box.width <= sheet.x + sheet.width).toBe(
			true
		);

		await mine.click();
		await expect(page.getByTestId('draw-sheet')).toHaveCount(0);
		await expect.poll(() => drawingStars(kidId)).toEqual([{ delta: 1, status: 'approved' }]);

		// Second drawing the same day: no second star, and the hint now shows the streak.
		await openBoard(page);
		await stroke(page);
		await page.getByTestId('draw-post').click();
		await expect(mine.getByTestId('draw-author-hint')).toHaveText('1-day streak');
		await mine.click();
		await expect(page.getByTestId('draw-sheet')).toHaveCount(0);
		await page.waitForTimeout(300);
		expect(drawingStars(kidId)).toHaveLength(1);

		// It is the ledger that counts: the server says so after a reload.
		const body = await (await page.request.get('/api/drawing-stars')).json();
		expect(body.streaks[kidId]).toEqual({ streak: 1, earned: true });
	} finally {
		db((d) => d.prepare('DELETE FROM notes WHERE author_id = ?').run(kidId));
	}
});

test('no star when the board is not showing the prompt @J18.21', async ({ page }, info) => {
	const tag = `n${Date.now().toString(36)}${info.workerIndex}${info.repeatEachIndex}`;
	const kidId = `e2e-star-kid-${tag}`;
	const kidName = `Kid ${tag}`;
	seedKid(kidId, kidName);
	setStars(null);
	await mockPrompt(page, false);
	try {
		await openBoard(page);
		await expect(page.getByTestId('draw-prompt-banner')).toHaveCount(0);
		await postAs(page, kidName);
		await page.waitForTimeout(500);
		expect(drawingStars(kidId)).toHaveLength(0);
	} finally {
		db((d) => d.prepare('DELETE FROM notes WHERE author_id = ?').run(kidId));
	}
});

// The setting is shared household state and both wall projects run at once, so this one feeds the
// endpoint through a route (the server rule itself is unit tested) instead of flipping the real flag.
test('a grown-up turns prompt stars off in Settings > Drawing @J18.21', async ({ page }) => {
	ensureHousehold();
	let current = true;
	const puts: unknown[] = [];
	await page.route('**/api/settings/drawing-stars', async (route) => {
		if (route.request().method() === 'PUT') {
			const body = route.request().postDataJSON();
			puts.push(body);
			current = body.enabled;
		}
		await route.fulfill({ json: { enabled: current } });
	});
	await signInAsAdult(page, 'e2e-baseline-adult');
	await gotoHydrated(page, '/settings/drawing');
	const off = page.getByTestId('drawing-stars-off');
	await expectTappable(off, 60);
	await expect(page.getByTestId('drawing-stars-on')).toHaveAttribute('aria-pressed', 'true');
	await off.click();
	await expect(off).toHaveAttribute('aria-pressed', 'true');
	expect(puts).toEqual([{ enabled: false }]);
});
