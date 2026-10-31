import { expect, test, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { ensureHousehold } from './adult';
import { gotoHydrated } from './hydrated';
import { expectTappable } from './tap';
import { trackMember } from './cleanup';
import { DB_PATH } from './data-dir';

// hub-cn7.13: more colors (white, greys, browns, skin tones) and an opacity step.

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

/** Alpha of the most opaque ink pixel, and how many pixels have any ink. */
const inkAlpha = (page: Page) =>
	page.getByTestId('draw-canvas').evaluate((c: HTMLCanvasElement) => {
		const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
		let max = 0;
		let n = 0;
		for (let i = 3; i < d.length; i += 4) {
			if (d[i] > 0) n++;
			if (d[i] > max) max = d[i];
		}
		return { max, n };
	});

async function stroke(page: Page, type: string, from: [number, number], to: [number, number]) {
	await page.getByTestId('draw-canvas').evaluate(
		(c, a) => {
			const r = c.getBoundingClientRect();
			const fire = (name: string, x: number, y: number) =>
				c.dispatchEvent(
					new PointerEvent(name, {
						pointerId: 1,
						pointerType: a.type,
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
			for (let i = 1; i <= 8; i++)
				fire(
					'pointermove',
					a.from[0] + ((a.to[0] - a.from[0]) * i) / 8,
					a.from[1] + ((a.to[1] - a.from[1]) * i) / 8
				);
			fire('pointerup', a.to[0], a.to[1]);
		},
		{ type, from, to }
	);
}

test('white, grey, brown and skin colors, and a faded pen and shape @J18.15', async ({
	page
}, info) => {
	const kidId = `e2e-draw-kid14-${info.workerIndex}${info.repeatEachIndex}`;
	seedKid(kidId, 'Kid Colors');
	try {
		await gotoHydrated(page, '/');
		await page.getByTestId('note-draw').click();
		const canvas = page.getByTestId('draw-canvas');

		// The grid now has the extra rows, and a pick lands in recent colors.
		await page.getByTestId('draw-more-colors').click();
		await expect(page.getByTestId('draw-grid-color')).toHaveCount(48);
		await page.getByTestId('draw-grid-color').nth(24).click(); // white
		await expect(page.getByTestId('draw-grid')).toHaveCount(0);

		// Opacity steps are tappable; a faded pen stroke is translucent, an opaque one is not.
		await expectTappable(page.getByTestId('draw-opacity').first(), 96);
		await expect(page.getByTestId('draw-opacity')).toHaveCount(4);
		await page.getByTestId('draw-more-colors').click();
		await page.getByTestId('draw-grid-color').nth(40).click(); // a skin tone
		await page.getByTestId('draw-opacity').and(page.locator('[data-opacity="0.5"]')).click();
		await stroke(page, 'touch', [0.1, 0.2], [0.6, 0.2]);
		const faded = await inkAlpha(page);
		expect(faded.n).toBeGreaterThan(100);
		expect(faded.max).toBeLessThan(160);

		await page.getByTestId('draw-opacity').and(page.locator('[data-opacity="1"]')).click();
		await stroke(page, 'touch', [0.1, 0.6], [0.6, 0.6]);
		expect((await inkAlpha(page)).max).toBe(255);

		// A placed shape fades when opacity changes while it is selected, then undo removes it.
		await page.getByTestId('draw-undo').click();
		await page.getByTestId('draw-undo').click();
		await expect(canvas).toHaveAttribute('data-strokes', '0');
		await page.getByTestId('draw-shapes-open').click();
		await page.getByTestId('draw-shape').and(page.locator('[data-shape="square"]')).click();
		await stroke(page, 'touch', [0.2, 0.2], [0.5, 0.45]);
		await expect(canvas).toHaveAttribute('data-selected', 'true');
		expect((await inkAlpha(page)).max).toBe(255);
		await page.getByTestId('draw-opacity').and(page.locator('[data-opacity="0.25"]')).click();
		await expect(canvas).toHaveAttribute('data-strokes', '1');
		expect((await inkAlpha(page)).max).toBeLessThan(100);
		await page.getByTestId('draw-shapes-open').click();
		await page.getByTestId('draw-shape-off').click();
		await page.getByTestId('draw-undo').click();
		await expect(canvas).toHaveAttribute('data-strokes', '0');
		await page.getByTestId('draw-close').click();
	} finally {
		const db = new Database(DB_PATH);
		db.pragma('busy_timeout = 5000');
		db.prepare('DELETE FROM saved_drawings WHERE member_id = ?').run(kidId);
		db.close();
	}
});
