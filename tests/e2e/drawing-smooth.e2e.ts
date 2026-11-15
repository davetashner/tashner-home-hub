import { expect, test, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { ensureHousehold } from './adult';
import { gotoHydrated } from './hydrated';
import { trackMember } from './cleanup';
import { DB_PATH } from './data-dir';
import { expectTappable } from './tap';

// hub-t27j.7: Smooth lines steadies a wobbly freehand line; off by default, remembered per device.

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

/** A flat line along the middle that zig-zags 40 CSS px up and down at every sample. */
async function wobble(page: Page) {
	await page.getByTestId('draw-canvas').evaluate((c) => {
		const r = c.getBoundingClientRect();
		const fire = (name: string, x: number, y: number) =>
			c.dispatchEvent(
				new PointerEvent(name, {
					pointerId: 1,
					pointerType: 'pen',
					pressure: 0.8,
					isPrimary: true,
					button: 0,
					buttons: name === 'pointerup' ? 0 : 1,
					clientX: r.left + x,
					clientY: r.top + y,
					bubbles: true
				})
			);
		const mid = r.height / 2;
		fire('pointerdown', 100, mid);
		for (let i = 1; i <= 30; i++) fire('pointermove', 100 + i * 20, mid + (i % 2 ? -40 : 40));
		fire('pointerup', 700, mid);
	});
}

/** Vertical extent of the ink, in CSS px. */
const inkHeight = (page: Page) =>
	page.getByTestId('draw-canvas').evaluate((c: HTMLCanvasElement) => {
		const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
		let lo = c.height;
		let hi = -1;
		for (let y = 0; y < c.height; y++)
			for (let x = 0; x < c.width; x++)
				if (d[(y * c.width + x) * 4 + 3] > 0) {
					lo = Math.min(lo, y);
					hi = Math.max(hi, y);
				}
		return hi < 0 ? 0 : ((hi - lo) * c.getBoundingClientRect().height) / c.height;
	});

test('Smooth lines steadies a wobbly stroke, is undoable and remembered @J18.24', async ({
	page
}, info) => {
	const tag = `m${Date.now().toString(36)}${info.workerIndex}${info.repeatEachIndex}`;
	seedKid(`e2e-smooth-kid-${tag}`, `Kid ${tag}`);
	await gotoHydrated(page, '/');
	await page.getByTestId('note-draw').click();
	const canvas = page.getByTestId('draw-canvas');
	const smooth = page.getByTestId('draw-smooth');
	await expectTappable(smooth, 96);

	// Off by default: the wobble is inked as drawn.
	await expect(smooth).toHaveAttribute('aria-pressed', 'false');
	await wobble(page);
	await expect(canvas).toHaveAttribute('data-strokes', '1');
	const raw = await inkHeight(page);
	expect(raw).toBeGreaterThan(70);
	await page.getByTestId('draw-undo').click();
	await expect(canvas).toHaveAttribute('data-strokes', '0');

	// On: the same wobble is much flatter, and Undo takes it away as one step.
	await smooth.click();
	await expect(smooth).toHaveAttribute('aria-pressed', 'true');
	await wobble(page);
	await expect(canvas).toHaveAttribute('data-strokes', '1');
	expect(await inkHeight(page)).toBeLessThan(raw * 0.8);
	await page.getByTestId('draw-undo').click();
	await expect(canvas).toHaveAttribute('data-strokes', '0');

	// 4K monitor: the toggle stays inside the viewport.
	await page.setViewportSize({ width: 3840, height: 2160 });
	const box = await smooth.boundingBox();
	expect(box && box.x + box.width <= 3840 && box.y + box.height <= 2160).toBe(true);

	// Remembered on reload.
	await page.reload();
	await page.getByTestId('note-draw').click();
	await expect(page.getByTestId('draw-smooth')).toHaveAttribute('aria-pressed', 'true');
	await page.getByTestId('draw-smooth').click();
	await expect(page.getByTestId('draw-smooth')).toHaveAttribute('aria-pressed', 'false');
});
