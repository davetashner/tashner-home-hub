import { expect, test, type Page } from '@playwright/test';
import { gotoHydrated } from './hydrated';
import { expectTappable } from './tap';

// hub-cn7.24: pinch to zoom, two-finger pan, Fit. Fingers are dispatched PointerEvents.

type Ev = { name: string; id: number; type: string; x: number; y: number };

/** Fire pointer events at the canvas; x and y are fractions of the (unzoomed) holder. */
async function fire(page: Page, events: Ev[]) {
	await page.getByTestId('draw-holder').evaluate((h, evs) => {
		const r = h.getBoundingClientRect();
		const c = h.querySelector('[data-testid="draw-canvas"]')!;
		for (const e of evs)
			c.dispatchEvent(
				new PointerEvent(e.name, {
					pointerId: e.id,
					pointerType: e.type,
					pressure: 0.5,
					isPrimary: e.id === 1,
					button: 0,
					buttons: e.name === 'pointerup' ? 0 : 1,
					clientX: r.left + e.x * r.width,
					clientY: r.top + e.y * r.height,
					bubbles: true
				})
			);
	}, events);
}

const ink = (page: Page) =>
	page.getByTestId('draw-canvas').evaluate((c: HTMLCanvasElement) => {
		const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
		let n = 0;
		for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
		return n;
	});

const scale = async (page: Page) =>
	Number(await page.getByTestId('draw-stack').getAttribute('data-scale'));

const f = (name: string, id: number, x: number, y: number, type = 'touch'): Ev => ({
	name,
	id,
	type,
	x,
	y
});

async function spread(page: Page) {
	await fire(page, [
		f('pointerdown', 1, 0.45, 0.5),
		f('pointerdown', 2, 0.55, 0.5),
		f('pointermove', 2, 0.65, 0.5),
		f('pointermove', 1, 0.35, 0.5)
	]);
}

test('pinch zooms, a second finger leaves no stray mark, Fit resets', async ({ page }) => {
	await gotoHydrated(page, '/');
	await page.getByTestId('note-draw').click();
	await expect(page.getByTestId('draw-sheet')).toBeVisible();
	await expectTappable(page.getByTestId('draw-fit'), 96);
	await expect(page.getByTestId('draw-fit')).toBeDisabled();

	// The first finger starts a stroke, the second cancels it: nothing is left behind.
	await fire(page, [
		f('pointerdown', 1, 0.45, 0.5),
		f('pointermove', 1, 0.46, 0.5),
		f('pointermove', 1, 0.47, 0.5),
		f('pointerdown', 2, 0.55, 0.5),
		f('pointermove', 2, 0.65, 0.5),
		f('pointermove', 1, 0.35, 0.5)
	]);
	expect(await ink(page)).toBe(0);
	await expect(page.getByTestId('draw-canvas')).toHaveAttribute('data-strokes', '0');
	expect(await scale(page)).toBeGreaterThan(1.5);
	await fire(page, [f('pointerup', 1, 0.35, 0.5), f('pointerup', 2, 0.65, 0.5)]);

	// A one-finger drag afterwards draws again, in board coordinates.
	await fire(page, [
		f('pointerdown', 3, 0.4, 0.5),
		f('pointermove', 3, 0.5, 0.5),
		f('pointerup', 3, 0.5, 0.5)
	]);
	await expect(page.getByTestId('draw-canvas')).toHaveAttribute('data-strokes', '1');
	expect(await ink(page)).toBeGreaterThan(0);

	// Fit goes back to 1x; the backing size never changed.
	await expect(page.getByTestId('draw-fit')).toBeEnabled();
	await page.getByTestId('draw-fit').click();
	expect(await scale(page)).toBe(1);
	await expect(page.getByTestId('draw-stack')).toHaveAttribute('data-pan', '0.0,0.0');
});

test('zoom is capped at 4x and two fingers pan', async ({ page }) => {
	await gotoHydrated(page, '/');
	await page.getByTestId('note-draw').click();
	await fire(page, [
		f('pointerdown', 1, 0.49, 0.5),
		f('pointerdown', 2, 0.51, 0.5),
		f('pointermove', 1, 0.05, 0.5),
		f('pointermove', 2, 0.95, 0.5)
	]);
	expect(await scale(page)).toBe(4);
	const before = await page.getByTestId('draw-stack').getAttribute('data-pan');
	await fire(page, [f('pointermove', 1, 0.15, 0.4), f('pointermove', 2, 1.05, 0.4)]);
	expect(await page.getByTestId('draw-stack').getAttribute('data-pan')).not.toBe(before);
	await fire(page, [f('pointerup', 1, 0.15, 0.4), f('pointerup', 2, 1.05, 0.4)]);
});

test('a pen keeps drawing while touches are ignored, zoomed or not', async ({ page }) => {
	await gotoHydrated(page, '/');
	await page.getByTestId('note-draw').click();
	await spread(page);
	await fire(page, [f('pointerup', 1, 0.35, 0.5), f('pointerup', 2, 0.65, 0.5)]);
	const z = await scale(page);
	expect(z).toBeGreaterThan(1);
	await fire(page, [
		f('pointermove', 9, 0.5, 0.5, 'pen'),
		f('pointerdown', 9, 0.4, 0.4, 'pen'),
		f('pointermove', 9, 0.6, 0.5, 'pen'),
		// A resting palm (two touches) neither zooms nor draws.
		f('pointerdown', 1, 0.3, 0.3),
		f('pointerdown', 2, 0.7, 0.7),
		f('pointermove', 2, 0.9, 0.9),
		f('pointerup', 9, 0.6, 0.5, 'pen')
	]);
	expect(await scale(page)).toBe(z);
	await expect(page.getByTestId('draw-canvas')).toHaveAttribute('data-strokes', '1');
});
