import { reveal } from './drawing-sections';
import { expect, test, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { ensureHousehold } from './adult';
import { gotoHydrated } from './hydrated';
import { expectTappable } from './tap';
import { trackMember } from './cleanup';
import { DB_PATH } from './data-dir';

// hub-t27j.12: step-by-step "How to draw" guides: faint lines to trace that are never ink.

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

function wipe(authorId: string) {
	const db = new Database(DB_PATH);
	db.pragma('busy_timeout = 5000');
	db.prepare('DELETE FROM notes WHERE author_id = ?').run(authorId);
	db.prepare('DELETE FROM saved_drawings WHERE member_id = ?').run(authorId);
	db.close();
}

const inkPixels = (page: Page) =>
	page.getByTestId('draw-canvas').evaluate((c: HTMLCanvasElement) => {
		const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
		let n = 0;
		for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
		return n;
	});

async function stroke(page: Page) {
	await page.getByTestId('draw-canvas').evaluate((c) => {
		const r = c.getBoundingClientRect();
		const fire = (name: string, t: number) =>
			c.dispatchEvent(
				new PointerEvent(name, {
					pointerId: 1,
					pointerType: 'pen',
					pressure: 0.8,
					isPrimary: true,
					button: 0,
					buttons: name === 'pointerup' ? 0 : 1,
					clientX: r.left + (0.1 + 0.5 * t) * r.width,
					clientY: r.top + (0.2 + 0.3 * t) * r.height,
					bubbles: true
				})
			);
		fire('pointerdown', 0);
		for (let i = 1; i <= 8; i++) fire('pointermove', i / 8);
		fire('pointerup', 1);
	});
}

test('a how-to-draw guide shows faint steps to trace, never as ink @J18.20', async ({
	page
}, info) => {
	const kidId = `e2e-guide-kid-${info.workerIndex}${info.repeatEachIndex}`;
	const name = `Guide Kid ${info.workerIndex}${info.repeatEachIndex}`;
	seedKid(kidId, name);
	try {
		await gotoHydrated(page, '/');
		await page.getByTestId('note-draw').click();
		await expect(page.getByTestId('draw-guide-layer')).toHaveCount(0);
		await reveal(page, 'draw-guide-open');
		await expectTappable(page.getByTestId('draw-guide-open'), 96);
		await page.getByTestId('draw-guide-open').click();
		expect(await page.getByTestId('draw-guide-pick').count()).toBeGreaterThanOrEqual(6);
		await expectTappable(page.getByTestId('draw-guide-pick').first(), 96);
		await page.locator('[data-testid="draw-guide-pick"][data-guide="cat"]').click();

		const layer = page.getByTestId('draw-guide-layer');
		const bar = page.getByTestId('draw-guide-bar');
		await expect(layer).toBeVisible();
		await expect(layer.locator('path')).toHaveCount(1);
		await expect(page.getByTestId('draw-guide-step')).toHaveText('Step 1 of 5');
		for (const id of ['back', 'next', 'done']) {
			await expectTappable(page.getByTestId(`draw-guide-${id}`), 96);
		}
		await expect(page.getByTestId('draw-guide-back')).toBeDisabled();

		// Next adds the next step's lines and keeps the earlier ones; Back goes back.
		await page.getByTestId('draw-guide-next').click();
		await expect(layer.locator('path')).toHaveCount(2);
		await expect(page.getByTestId('draw-guide-step')).toHaveText('Step 2 of 5');
		await page.getByTestId('draw-guide-back').click();
		await expect(layer.locator('path')).toHaveCount(1);
		for (let i = 0; i < 6; i++) {
			if (await page.getByTestId('draw-guide-next').isEnabled())
				await page.getByTestId('draw-guide-next').click();
		}
		await expect(page.getByTestId('draw-guide-step')).toHaveText('Step 5 of 5');
		await expect(page.getByTestId('draw-guide-next')).toBeDisabled();

		// The guide is not ink: nothing on the canvas, and it never erases or counts as a stroke.
		const canvas = page.getByTestId('draw-canvas');
		await expect(canvas).toHaveAttribute('data-strokes', '0');
		expect(await inkPixels(page)).toBe(0);
		await stroke(page);
		await expect(canvas).toHaveAttribute('data-strokes', '1');
		const ink = await inkPixels(page);
		expect(ink).toBeGreaterThan(100);
		await page.getByTestId('draw-undo').click();
		await expect(canvas).toHaveAttribute('data-strokes', '0');
		await expect(layer).toBeVisible();
		await page.getByTestId('draw-redo').click();
		await expect(canvas).toHaveAttribute('data-strokes', '1');

		// Saved with the guide showing: only the one stroke is stored.
		await page.getByTestId('draw-save').click();
		await page.getByTestId('draw-author').filter({ hasText: name }).click();
		await expect(page.getByTestId('draw-note')).toHaveText('Saved!');
		await page.getByTestId('draw-guide-done').click();
		await expect(bar).toHaveCount(0);
		await expect(layer).toHaveCount(0);
		await reveal(page, 'draw-clear');
		await page.getByTestId('draw-clear').click();
		await page.getByTestId('draw-browse').click();
		await page.getByRole('button', { name: `Open drawing by ${name}` }).click();
		await expect(canvas).toHaveAttribute('data-strokes', '1');
		expect(Math.abs((await inkPixels(page)) - ink)).toBeLessThan(ink * 0.02); // stored points are rounded
		await expect(layer).toHaveCount(0);

		// Fits at the 4K touch monitor with nothing overflowing.
		const wall = page.viewportSize();
		await page.setViewportSize({ width: 3840, height: 2160 });
		await reveal(page, 'draw-guide-open');
		await page.getByTestId('draw-guide-open').click();
		await page.locator('[data-testid="draw-guide-pick"][data-guide="house"]').click();
		const box = await bar.boundingBox();
		expect(box && box.x >= 0 && box.x + box.width <= 3840).toBe(true);
		expect(
			await page.getByTestId('draw-guide-next').evaluate((el) => el.scrollWidth <= el.clientWidth)
		).toBe(true);
		if (wall) await page.setViewportSize(wall);
	} finally {
		wipe(kidId);
	}
});
