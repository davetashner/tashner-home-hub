import { expect, test, type Page } from '@playwright/test';
import { ensureHousehold } from './adult';
import { holdLock } from './file-lock';
import { gotoHydrated } from './hydrated';
import { expectTappable } from './tap';

// hub-cn7.30: live shared board: invite, join, strokes, own undo, late joiner, offline.

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

test('draw together: invite, join, live strokes, own undo, late joiner, offline @J18.16', async ({
	page,
	browser
}) => {
	test.setTimeout(90_000);
	ensureHousehold();
	// Invitations reach every device on the server, so the two wall projects take turns.
	const release = await holdLock('drawing-live');
	const b = await device(browser, page);
	const c = await device(browser, page);
	try {
		await gotoHydrated(page, '/');
		await page.getByTestId('note-draw').click();
		const share = page.getByTestId('draw-share');
		await expectTappable(share);
		await share.click();
		await expect(page.getByTestId('draw-live-status')).toHaveAttribute('data-online', 'true');
		await expect(page.getByTestId('draw-clear')).toBeDisabled();

		// The other devices are invited; B joins with one tap.
		await expect(b.page.getByTestId('draw-invite')).toBeVisible();
		await expect(c.page.getByTestId('draw-invite')).toBeVisible();
		await b.page.getByTestId('draw-invite-join').click();
		await expect(b.page.getByTestId('draw-live-status')).toBeVisible();

		await stroke(page, [0.1, 0.2], [0.4, 0.2]);
		await expect.poll(() => inkPixels(b.page)).toBeGreaterThan(0);
		const first = await inkPixels(page);
		expect(first).toBeGreaterThan(0);

		await c.page.getByTestId('draw-invite-join').click();
		await expect.poll(() => inkPixels(c.page)).toBeGreaterThan(0);

		// B draws; A sees it; B's undo removes only B's stroke.
		await stroke(b.page, [0.1, 0.7], [0.5, 0.7]);
		await expect.poll(() => inkPixels(page)).toBeGreaterThan(first);
		await b.page.getByTestId('draw-undo').click();
		await expect.poll(() => inkPixels(page)).toBe(first);
		expect(await inkPixels(b.page)).toBeGreaterThan(0);

		// B loses the connection, keeps drawing, and it all arrives once back online.
		await b.context.setOffline(true);
		await stroke(b.page, [0.6, 0.5], [0.9, 0.5]);
		await expect(b.page.getByTestId('draw-live-status')).toHaveAttribute('data-online', 'false', {
			timeout: 20_000
		});
		expect(await inkPixels(page)).toBe(first);
		await b.context.setOffline(false);
		await expect.poll(() => inkPixels(page), { timeout: 30_000 }).toBeGreaterThan(first);

		await page.getByTestId('draw-live-leave').click();
		await expect(page.getByTestId('draw-share')).toBeVisible();
		await expect(page.getByTestId('draw-clear')).toBeEnabled();
		expect(await inkPixels(page)).toBeGreaterThan(first);
	} finally {
		release();
		await Promise.all([b.page.goto('about:blank'), c.page.goto('about:blank')]).catch(() => {});
		await Promise.all([b.context.close(), c.context.close()]);
	}
});
