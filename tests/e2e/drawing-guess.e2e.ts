import { reveal } from './drawing-sections';
import { expect, test, type Page } from '@playwright/test';
import { ensureHousehold } from './adult';
import { holdLock } from './file-lock';
import { gotoHydrated } from './hydrated';
import { expectTappable } from './tap';

// hub-t27j.10: draw and guess between two boards: secret word, four choices, right/wrong, swap, drop.

const inkPixels = (page: Page) =>
	page.getByTestId('draw-canvas').evaluate((c: HTMLCanvasElement) => {
		const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
		let n = 0;
		for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
		return n;
	});

async function stroke(page: Page, from: [number, number], to: [number, number]) {
	await page.getByTestId('draw-canvas').evaluate(
		(c, a) => {
			const r = c.getBoundingClientRect();
			const fire = (name: string, x: number, y: number) =>
				c.dispatchEvent(
					new PointerEvent(name, {
						pointerId: 1,
						pointerType: 'pen',
						pressure: 0.5,
						isPrimary: true,
						button: 0,
						buttons: name === 'pointerup' ? 0 : 1,
						clientX: r.left + x * r.width,
						clientY: r.top + y * r.height,
						bubbles: true
					})
				);
			fire('pointerdown', a.from[0], a.from[1]);
			fire('pointermove', (a.from[0] + a.to[0]) / 2, (a.from[1] + a.to[1]) / 2);
			fire('pointermove', a.to[0], a.to[1]);
			fire('pointerup', a.to[0], a.to[1]);
		},
		{ from, to }
	);
}

async function device(browser: import('@playwright/test').Browser, like: Page) {
	const context = await browser.newContext({ viewport: like.viewportSize() ?? undefined });
	const page = await context.newPage();
	await gotoHydrated(page, '/');
	return { context, page };
}

test('draw and guess: secret word, four choices, right and wrong, new round, drop @J18.35', async ({
	page,
	browser
}) => {
	test.setTimeout(90_000);
	ensureHousehold();
	const release = await holdLock('drawing-live');
	const b = await device(browser, page);
	try {
		await gotoHydrated(page, '/');
		await page.getByTestId('note-draw').click();
		await reveal(page, 'draw-share');
		await page.getByTestId('draw-share').click();
		await reveal(page, 'draw-live-status');
		await b.page.getByTestId('draw-invite-join').click();
		await reveal(b.page, 'draw-live-status');

		const start = page.getByTestId('draw-guess-start');
		await expectTappable(start, 96);
		await start.click();

		// A draws the secret word; B has never been told it.
		const a = page.getByTestId('draw-guess');
		await expect(a).toHaveAttribute('data-role', 'drawer');
		await expect(page.getByTestId('draw-guess-word')).toContainText('Draw:');
		await expect(page.getByTestId('draw-guess-word')).not.toContainText('...');
		const word = (
			(await page.getByTestId('draw-guess-word').locator('span').textContent()) ?? ''
		).trim();
		expect(word.length).toBeGreaterThan(1);

		// B sees the strokes live and four big choices that include the answer.
		await stroke(page, [0.1, 0.2], [0.5, 0.2]);
		await expect.poll(() => inkPixels(b.page)).toBeGreaterThan(0);
		const choices = b.page.getByTestId('draw-guess-choice');
		await expect(choices).toHaveCount(4);
		for (const c of await choices.all()) await expectTappable(c, 96);
		const labels = (await choices.allTextContents()).map((t) => t.trim());
		expect(labels).toContain(word);
		await expect(b.page.getByTestId('draw-guess')).not.toContainText('Draw:');
		await expect(b.page.getByTestId('draw-guess')).toHaveAttribute('data-role', 'guesser');

		// The choices fit their card on the 4K touch monitor as well.
		const wall = b.page.viewportSize();
		for (const size of [{ width: 3840, height: 2160 }, wall]) {
			if (size) await b.page.setViewportSize(size);
			const card = await b.page.getByTestId('draw-guess').boundingBox();
			for (const c of await choices.all()) {
				const box = await c.boundingBox();
				expect(box!.x + box!.width).toBeLessThanOrEqual(card!.x + card!.width + 1);
				expect(await c.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
			}
		}

		// Wrong: a gentle try again; right: both boards celebrate.
		await choices.nth(labels.findIndex((l) => l !== word)).click();
		await expect(b.page.getByTestId('draw-guess-wrong')).toContainText('try again');
		await expect(page.getByTestId('draw-guess-status')).toContainText('1 wrong');
		await choices.nth(labels.indexOf(word)).click();
		await expect(b.page.getByTestId('draw-guess-win')).toContainText(word);
		await expect(page.getByTestId('draw-guess-win')).toContainText(word);

		// New round swaps roles: B now draws, A guesses.
		const next = page.getByTestId('draw-guess-next');
		await expectTappable(next, 96);
		await next.click();
		await expect(b.page.getByTestId('draw-guess')).toHaveAttribute('data-role', 'drawer');
		await expect(page.getByTestId('draw-guess')).toHaveAttribute('data-role', 'guesser');
		await expect(b.page.getByTestId('draw-guess-word')).not.toContainText('...');
		await expect(page.getByTestId('draw-guess-choice')).toHaveCount(4);

		// A drops: the round ends cleanly on B.
		await page.context().setOffline(true);
		await expect(b.page.getByTestId('draw-guess')).toBeHidden({ timeout: 30_000 });
		await page.context().setOffline(false);
	} finally {
		release();
		await b.page.goto('about:blank').catch(() => {});
		await b.context.close();
	}
});
