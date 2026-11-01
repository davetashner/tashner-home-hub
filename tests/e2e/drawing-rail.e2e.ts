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

test('Paper, Magic and Together are big labeled rail sections and More is gone', async ({
	page
}) => {
	await openBoard(page);
	for (const x of ['paper', 'magic', 'together']) {
		const wrap = page.getByTestId(`draw-rail-${x}`);
		await expectTappable(wrap, 96);
		await expect(wrap.getByRole('button')).toContainText(/\S/);
	}
	await expect(page.getByTestId('draw-more-title')).toHaveCount(0);
	await expect(page.getByTestId('draw-mirror')).toHaveCount(0);
});

test('Paper shows exactly its five controls', async ({ page }) => {
	await openBoard(page);
	await page.getByTestId('draw-rail-paper').click();
	await expect(page.getByTestId('draw-options-title')).toHaveText('Paper');
	for (const id of ['pages-open', 'photo-open', 'bg-open', 'layers-open', 'clear']) {
		await expect(page.getByTestId(`draw-${id}`)).toBeVisible();
	}
	await expect(page.getByTestId('draw-options-title')).toHaveCount(1);
	await expect(page.getByTestId('draw-mirror')).toHaveCount(0);
	await expect(page.getByTestId('draw-size')).toHaveCount(0);
});

test('Magic keeps the active tool and the tool options come back', async ({ page }) => {
	await openBoard(page);
	await page.getByTestId('draw-rail-eraser').click();
	await page.getByTestId('draw-rail-magic').click();
	await expect(page.getByTestId('draw-options-title')).toHaveText('Magic');
	await expect(page.getByTestId('draw-mirror')).toBeVisible();
	await expect(page.getByTestId('draw-flipbook')).toBeVisible();
	await expect(page.getByTestId('draw-rail-magic').getByRole('button')).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	// The eraser is still the active tool while the section is open.
	await expect(page.getByTestId('draw-rail-eraser').getByRole('button')).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	// Tapping the section again returns to the tool's options.
	await page.getByTestId('draw-rail-magic').click();
	await expect(page.getByTestId('draw-options-title')).toHaveText('Eraser');
	// So does tapping the active tool.
	await page.getByTestId('draw-rail-together').click();
	await expect(page.getByTestId('draw-options-title')).toHaveText('Together');
	await expect(page.getByTestId('draw-share')).toBeVisible();
	await page.getByTestId('draw-rail-eraser').click();
	await expect(page.getByTestId('draw-options-title')).toHaveText('Eraser');
	await expect(page.getByTestId('draw-share')).toHaveCount(0);
});

test('Paper still opens the Background panel and Back returns to Paper', async ({ page }) => {
	await openBoard(page);
	await page.getByTestId('draw-rail-paper').click();
	await page.getByTestId('draw-bg-open').click();
	await expect(page.getByLabel('Background colors')).toBeVisible();
	await page.getByTestId('draw-bg-close').click();
	await expect(page.getByTestId('draw-options-title')).toHaveText('Paper');
});
