import { expect, test } from '@playwright/test';
import { gotoHydrated } from './hydrated';
import { expectTappable } from './tap';
import { ensureHousehold } from './adult';

// hub-cn7.37.3: a rail of big labeled tools and an options panel for the chosen tool only.

// The home page only shows notes (and the draw button) once a household exists.
test.beforeAll(() => ensureHousehold());

const TOOLS = ['pen', 'marker', 'eraser', 'fill', 'shapes', 'text', 'pick'] as const;

async function openBoard(page: import('@playwright/test').Page) {
	await gotoHydrated(page, '/');
	await page.getByTestId('note-draw').click();
	await expect(page.getByTestId('draw-sheet')).toBeVisible();
}

test('the rail has seven big labeled tools and Pen starts chosen', async ({ page }) => {
	await openBoard(page);
	for (const t of TOOLS) {
		const wrap = page.getByTestId(`draw-rail-${t}`);
		await expectTappable(wrap, 96);
		await expect(wrap.getByRole('button')).toContainText(/\S/);
	}
	await expect(page.getByTestId('draw-rail-pen').getByRole('button')).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(page.getByTestId('draw-options-title')).toHaveText('Pen');
	await expect(page.getByTestId('draw-more-colors')).toBeVisible();
});

test('Eraser shows only the size options', async ({ page }) => {
	await openBoard(page);
	await page.getByTestId('draw-rail-eraser').click();
	await expect(page.getByTestId('draw-options-title')).toHaveText('Eraser');
	await expect(page.getByTestId('draw-size').first()).toBeVisible();
	await expect(page.getByTestId('draw-color')).toHaveCount(0);
	await expect(page.getByTestId('draw-opacity')).toHaveCount(0);
	await expect(page.getByTestId('draw-brush-rainbow')).toHaveCount(0);
});

test('Shapes shows the shapes, Pick color shows a hint', async ({ page }) => {
	await openBoard(page);
	await page.getByTestId('draw-rail-shapes').click();
	await expect(page.getByTestId('draw-shapes')).toBeVisible();
	await expect(page.getByTestId('draw-brush-rainbow')).toHaveCount(0);
	await page.getByTestId('draw-rail-pick').click();
	await expect(page.getByText('Tap the drawing to pick a color.')).toBeVisible();
	await expect(page.getByTestId('draw-shapes')).toHaveCount(0);
});

test('the More group still opens the Background panel', async ({ page }) => {
	await openBoard(page);
	await page.getByTestId('draw-rail-eraser').click();
	await expect(page.getByTestId('draw-more-title')).toBeVisible();
	await page.getByTestId('draw-bg-open').click();
	await expect(page.getByLabel('Background colors')).toBeVisible();
	await page.getByTestId('draw-bg-close').click();
	await expect(page.getByTestId('draw-more-title')).toBeVisible();
});
