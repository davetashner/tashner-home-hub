import { reveal } from './drawing-sections';
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { ensureHousehold } from './adult';
import { holdLock } from './file-lock';
import { gotoHydrated } from './hydrated';

// hub-t27j.22 (J18.36): lasso edits reach the other board while drawing together, and eraser
// cuts over lassoed ink travel with it.

type P = [number, number];

async function gesture(target: Locator, pts: P[]) {
	await target.evaluate((el, pts) => {
		const fire = (name: string, [x, y]: [number, number]) =>
			el.dispatchEvent(
				new PointerEvent(name, {
					pointerId: 1,
					pointerType: 'pen',
					pressure: 0.8,
					isPrimary: true,
					button: 0,
					buttons: name === 'pointerup' ? 0 : 1,
					clientX: x,
					clientY: y,
					bubbles: true
				})
			);
		fire('pointerdown', pts[0]);
		for (const p of pts.slice(1)) fire('pointermove', p);
		fire('pointerup', pts[pts.length - 1]);
	}, pts);
}

async function ink(page: Page, pts: P[]) {
	const r = (await page.getByTestId('draw-canvas').boundingBox())!;
	await gesture(
		page.getByTestId('draw-canvas'),
		pts.map(([x, y]) => [r.x + x * r.width, r.y + y * r.height])
	);
}

const along = (a: P, b: P, n = 8): P[] =>
	Array.from({ length: n + 1 }, (_, i) => [
		a[0] + ((b[0] - a[0]) * i) / n,
		a[1] + ((b[1] - a[1]) * i) / n
	]);

/** Alpha pixel count and top edge of the ink on a board. */
const stats = (page: Page) =>
	page.getByTestId('draw-canvas').evaluate((c: HTMLCanvasElement) => {
		const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
		let n = 0;
		let y0 = Infinity;
		for (let y = 0; y < c.height; y++)
			for (let x = 0; x < c.width; x++)
				if (d[(y * c.width + x) * 4 + 3] > 0) {
					n++;
					y0 = Math.min(y0, y);
				}
		return { n, y0 };
	});

async function device(browser: Browser, like: Page) {
	const context = await browser.newContext({ viewport: like.viewportSize() ?? undefined });
	const page = await context.newPage();
	await gotoHydrated(page, '/');
	return { context, page };
}

test('lasso: move and copy reach the other board; erased gaps move with the ink @J18.36', async ({
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
		const canvas = page.getByTestId('draw-canvas');

		// Ink with an eraser scribble across it, before sharing starts.
		await ink(page, along([0.15, 0.3], [0.3, 0.4]));
		const full = (await stats(page)).n;
		await page.getByTestId('draw-eraser').click();
		await ink(page, along([0.225, 0.28], [0.225, 0.42], 6));
		const cut = await stats(page);
		expect(cut.n).toBeLessThan(full);
		await page.getByTestId('draw-pen').click();

		await reveal(page, 'draw-share');
		await page.getByTestId('draw-share').click();
		await reveal(page, 'draw-live-status');
		await expect(page.getByTestId('draw-live-status')).toHaveAttribute('data-online', 'true');
		await b.page.getByTestId('draw-invite-join').click();
		await expect.poll(async () => (await stats(b.page)).n).toBeGreaterThan(0);
		const bStart = await stats(b.page);

		// Lasso the ink: the eraser cut comes with it (two strokes selected).
		await page.getByTestId('draw-lasso').click();
		await ink(page, [
			[0.1, 0.2],
			[0.35, 0.2],
			[0.35, 0.5],
			[0.1, 0.5],
			[0.1, 0.2]
		]);
		await expect(canvas).toHaveAttribute('data-lasso', '2');

		// Move it down: the ink and its gap move together, and the other board sees it.
		const f = (await canvas.getAttribute('data-lasso-frame'))!.split(',').map(Number);
		const r = (await canvas.boundingBox())!;
		const mid: P = [r.x + f[0] + f[2] / 2, r.y + f[1] + f[3] / 2];
		await gesture(canvas, along(mid, [mid[0] + 150, mid[1] + 200]));
		const moved = await stats(page);
		expect(moved.y0).toBeGreaterThan(cut.y0 + 50);
		expect(Math.abs(moved.n - cut.n)).toBeLessThan(cut.n * 0.05); // the gap travelled, not refilled
		await expect
			.poll(async () => (await stats(b.page)).y0, { timeout: 15_000 })
			.toBeGreaterThan(bStart.y0 + 50);
		expect(Math.abs((await stats(b.page)).n - moved.n)).toBeLessThan(moved.n * 0.05);

		// Copy: the other board gets a second copy of the ink.
		await page.getByTestId('draw-lasso-copy').click();
		await expect
			.poll(async () => (await stats(b.page)).n, { timeout: 15_000 })
			.toBeGreaterThan(moved.n * 1.5);

		await reveal(page, 'draw-live-leave');
		await page.getByTestId('draw-live-leave').click();
	} finally {
		release();
		await b.page.goto('about:blank').catch(() => {});
		await b.context.close();
	}
});
