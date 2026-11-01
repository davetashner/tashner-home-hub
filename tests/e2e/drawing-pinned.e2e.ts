import { expect, test } from '@playwright/test';
import { gotoHydrated } from './hydrated';
import { expectTappable } from './tap';

// hub-cn7.37.1: a pinned corner close, Esc stepping back one level, and pinned bars.

async function openBoard(page: import('@playwright/test').Page) {
	await gotoHydrated(page, '/');
	await page.getByTestId('note-draw').click();
	await expect(page.getByTestId('draw-sheet')).toBeVisible();
}

test('the corner close is a big named button that closes the board', async ({ page }) => {
	await openBoard(page);
	const close = page.getByRole('button', { name: 'Close drawing board' });
	await expectTappable(close, 96);
	await expect(close).toHaveAttribute('data-testid', 'draw-close');
	await close.click();
	await expect(page.getByTestId('draw-sheet')).toHaveCount(0);
});

test('Esc closes an open picker, then a sub-panel, then the board', async ({ page }) => {
	await openBoard(page);
	await page.getByTestId('draw-more-colors').click();
	await expect(page.getByTestId('draw-grid')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('draw-grid')).toHaveCount(0);
	await expect(page.getByTestId('draw-sheet')).toBeVisible();

	await page.getByTestId('draw-bg-open').click();
	await expect(page.getByLabel('Background colors')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByLabel('Background colors')).toHaveCount(0);
	await expect(page.getByTestId('draw-sheet')).toBeVisible();

	await page.keyboard.press('Escape');
	await expect(page.getByTestId('draw-sheet')).toHaveCount(0);
});

test('undo, save and post stay on screen without scrolling the tools', async ({ page }) => {
	await openBoard(page);
	const vp = page.viewportSize()!;
	for (const id of [
		'draw-undo',
		'draw-redo',
		'draw-fit',
		'draw-browse',
		'draw-save',
		'draw-post'
	]) {
		const box = await page.getByTestId(id).boundingBox();
		expect(box, id).not.toBeNull();
		expect(box!.y, id).toBeGreaterThanOrEqual(0);
		expect(box!.y + box!.height, id).toBeLessThanOrEqual(vp.height);
	}
	// Scrolling the middle of the column leaves the bars where they are.
	const post = page.getByTestId('draw-post');
	const before = await post.boundingBox();
	await page.getByTestId('draw-topbar').evaluate((el) => {
		(el.parentElement as HTMLElement).scrollTop = 99999;
	});
	const after = await post.boundingBox();
	expect(after!.y).toBeCloseTo(before!.y, 0);
});
