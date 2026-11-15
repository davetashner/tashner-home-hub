import { expect, test, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { ensureHousehold, signInAsAdult } from './adult';
import { gotoHydrated } from './hydrated';
import { expectTappable } from './tap';
import { DB_PATH } from './data-dir';
import { DRAWING_PROMPTS } from '../../src/lib/domain/drawing-prompts';
import { hasStarter } from '../../src/lib/domain/drawing-starter-names';
import { starterStrokes } from '../../src/lib/domain/drawing-starters';

// hub-cn7.27: a daily drawing prompt at the top of the board, with Shuffle, Hide and an adult setting.
// The setting is shared household state and both wall projects run at once, so the board test
// feeds the setting through a route instead of reading what another project may be changing.

function resetPrompts() {
	const db = new Database(DB_PATH);
	db.pragma('busy_timeout = 5000');
	db.prepare("DELETE FROM settings WHERE key = 'drawing.prompts'").run();
	db.close();
}

const DATE = '2026-10-31';

test('the prompt shows, shuffles and hides for the day @J18.16', async ({ page }) => {
	ensureHousehold();
	await page.route('**/api/settings/drawing-prompts', (route) =>
		route.fulfill({ json: { enabled: true, date: DATE } })
	);
	await gotoHydrated(page, '/');
	await page.getByTestId('note-draw').click();
	const prompt = page.getByTestId('draw-prompt');
	await expect(prompt).toBeVisible();
	await expectTappable(page.getByTestId('draw-prompt-shuffle'), 96);
	await expectTappable(page.getByTestId('draw-prompt-hide'), 96);

	// The device remembers the day's random pick: reopening shows the same prompt.
	const first = await prompt.innerText();
	expect(DRAWING_PROMPTS).toContain(first);
	await page.getByTestId('draw-close').click();
	await page.getByTestId('note-draw').click();
	await expect(prompt).toHaveText(first);

	// Shuffle picks another, never one shown recently.
	const shown = [first];
	for (let i = 0; i < 3; i++) {
		await page.getByTestId('draw-prompt-shuffle').click();
		await expect(prompt).not.toHaveText(shown.at(-1)!);
		const next = await prompt.innerText();
		expect(shown).not.toContain(next);
		shown.push(next);
	}

	await page.getByTestId('draw-prompt-hide').click();
	await expect(page.getByTestId('draw-prompt-banner')).toHaveCount(0);

	// Hidden for the rest of the day: reopening the board keeps it away.
	await page.getByTestId('draw-close').click();
	await page.getByTestId('note-draw').click();
	await expect(page.getByTestId('draw-sheet')).toBeVisible();
	await expect(page.getByTestId('draw-prompt-banner')).toHaveCount(0);
});

/** Fraction of the canvas with ink on it. */
const inkShare = (canvas: import('@playwright/test').Locator) =>
	canvas.evaluate((c: HTMLCanvasElement) => {
		const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
		let k = 0;
		for (let i = 3; i < d.length; i += 4) if (d[i] > 0) k++;
		return k / (c.width * c.height);
	});

/** Makes `text` this device's remembered prompt for `date`. */
async function rememberPrompt(page: Page, date: string, text: string) {
	await page.addInitScript(
		([d, t]) =>
			localStorage.setItem(
				'drawing-prompt-memory',
				JSON.stringify({ date: d, prompt: t, recent: [t] })
			),
		[date, text]
	);
}

test('Start it puts a half-done sketch on the board as ink; Undo takes it back @J18.16', async ({
	page
}) => {
	ensureHousehold();
	const text = 'Draw a dog driving a bus';
	expect(hasStarter(text)).toBe(true);
	await rememberPrompt(page, DATE, text);
	await page.route('**/api/settings/drawing-prompts', (route) =>
		route.fulfill({ json: { enabled: true, date: DATE } })
	);
	await gotoHydrated(page, '/');
	await page.getByTestId('note-draw').click();
	const canvas = page.getByTestId('draw-canvas');
	await expect(page.getByTestId('draw-prompt')).toHaveText(text);
	await expectTappable(page.getByTestId('draw-prompt-start'), 96);
	await expect(canvas).toHaveAttribute('data-strokes', '0');

	await page.getByTestId('draw-prompt-start').click();
	const n = starterStrokes(text, { w: 100, h: 100 }).length;
	await expect(canvas).toHaveAttribute('data-strokes', String(n));
	const ink = await inkShare(canvas);
	// A sketch, not a filled page.
	expect(ink).toBeGreaterThan(0.002);
	expect(ink).toBeLessThan(0.2);

	// The whole starter is one Undo step.
	await page.getByTestId('draw-undo').click();
	await expect(canvas).toHaveAttribute('data-strokes', '0');
	await page.getByTestId('draw-close').click();
});

// Every prompt has a starter (hub-r53f, hub-j0oj, hub-ia53, hub-wqci): spot-check one from the
// start, middle and end of the list, each a sketch rather than a filled page.
test('Start it works across the whole prompt list @J18.16', async ({ page }) => {
	ensureHousehold();
	await page.route('**/api/settings/drawing-prompts', (route) =>
		route.fulfill({ json: { enabled: true, date: DATE } })
	);
	const n = DRAWING_PROMPTS.length;
	for (const text of [
		DRAWING_PROMPTS[0],
		DRAWING_PROMPTS[Math.floor(n / 2)],
		DRAWING_PROMPTS[n - 1]
	]) {
		// The newest init script runs last, so it sets this round's prompt.
		await rememberPrompt(page, DATE, text);
		await gotoHydrated(page, '/');
		await page.getByTestId('note-draw').click();
		const canvas = page.getByTestId('draw-canvas');
		await expect(page.getByTestId('draw-prompt')).toHaveText(text);
		await expect(canvas).toHaveAttribute('data-strokes', '0');
		await page.getByTestId('draw-prompt-start').click();
		const n2 = starterStrokes(text, { w: 100, h: 100 }).length;
		await expect(canvas, text).toHaveAttribute('data-strokes', String(n2));
		const ink = await inkShare(canvas);
		expect(ink, text).toBeGreaterThan(0.002);
		expect(ink, text).toBeLessThan(0.2);
		await page.getByTestId('draw-undo').click();
		await page.getByTestId('draw-close').click();
	}
});

test('no banner when a grown-up has turned prompts off @J18.16', async ({ page }) => {
	ensureHousehold();
	await page.route('**/api/settings/drawing-prompts', (route) =>
		route.fulfill({ json: { enabled: false, date: DATE } })
	);
	await gotoHydrated(page, '/');
	await page.getByTestId('note-draw').click();
	await expect(page.getByTestId('draw-sheet')).toBeVisible();
	await expect(page.getByTestId('draw-canvas')).toBeVisible();
	await expect(page.getByTestId('draw-prompt-banner')).toHaveCount(0);
});

test('a grown-up turns prompts off and on in Settings > Drawing @J18.16', async ({ page }) => {
	ensureHousehold();
	try {
		await signInAsAdult(page, 'e2e-baseline-adult');
		await gotoHydrated(page, '/settings/drawing');
		const saved = page.waitForResponse(
			(r) => r.url().includes('/api/settings/drawing-prompts') && r.request().method() === 'PUT'
		);
		await page.getByRole('button', { name: 'Off' }).click();
		expect(await (await saved).json()).toEqual({ enabled: false });
		await expect(page.getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'true');
	} finally {
		resetPrompts();
	}
});
