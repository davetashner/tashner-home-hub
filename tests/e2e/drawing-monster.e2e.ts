import { reveal } from './drawing-sections';
import { expect, test, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { ensureHousehold } from './adult';
import { gotoHydrated } from './hydrated';
import { expectTappable } from './tap';
import { trackMember } from './cleanup';
import { DB_PATH } from './data-dir';

// hub-t27j.9: the Monster game, taking turns on one board: head, body, legs, then Reveal!

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

/** A stroke between two points given as fractions of the canvas box. */
async function stroke(page: Page, from: [number, number], to: [number, number]) {
	await page.getByTestId('draw-canvas').evaluate(
		(c, a) => {
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
		{ from, to }
	);
}

/** The topmost and bottommost canvas rows holding ink, as fractions of the board height; null when blank. */
const inkRows = (page: Page) =>
	page.getByTestId('draw-canvas').evaluate((c: HTMLCanvasElement) => {
		const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
		let top = -1;
		let bottom = -1;
		for (let y = 0; y < c.height; y++)
			for (let x = 0; x < c.width; x++)
				if (d[(y * c.width + x) * 4 + 3] > 0) {
					if (top < 0) top = y;
					bottom = y;
					break;
				}
		return top < 0 ? null : { top: top / c.height, bottom: bottom / c.height };
	});

async function open(page: Page) {
	await gotoHydrated(page, '/');
	await page.getByTestId('note-draw').click();
	await reveal(page, 'draw-monster');
}

test('monster game: each turn draws in one band, the rest is folded, reveal shows all @J18.28', async ({
	page
}, info) => {
	const name = `Kid Monster ${info.workerIndex}${info.repeatEachIndex}`;
	seedKid(`e2e-monster-kid-${info.workerIndex}${info.repeatEachIndex}`, name);
	await open(page);
	const start = page.getByTestId('draw-monster');
	await expectTappable(start, 96);
	await expectTappable(page.getByTestId('draw-monster-feet'), 96);
	await start.click();
	const cover = page.getByTestId('draw-monster-cover');
	const band = page.getByTestId('draw-monster-band');
	await expect(page.getByTestId('draw-monster-status')).toContainText('draw the head');
	await expect(cover).toHaveCount(0);
	await expect(band).toHaveAttribute('data-band-top', '0');

	// Turn 1 (head): a stroke that wanders far below the band is held inside the top third.
	await stroke(page, [0.3, 0.1], [0.5, 0.9]);
	const head = (await inkRows(page))!;
	expect(head.bottom).toBeLessThan(0.34);
	// A tap in another band does nothing.
	await stroke(page, [0.5, 0.8], [0.7, 0.9]);
	expect((await inkRows(page))!.bottom).toBeLessThan(0.34);
	await expect(page.getByTestId('draw-canvas')).toHaveAttribute('data-strokes', '1');
	// Save and Post wait for the reveal.
	await expect(page.getByTestId('draw-save')).toBeDisabled();
	await expect(page.getByTestId('draw-post')).toBeDisabled();

	const next = page.getByTestId('draw-monster-next');
	await expectTappable(next, 96);
	await next.click();

	// Turn 2 (body): the head is folded away except a thin strip; ink stays in the middle band.
	await expect(page.getByTestId('draw-monster-status')).toContainText('draw the body');
	await expect(cover).toBeVisible();
	const coverBox = (await cover.boundingBox())!;
	const canvasBox = (await page.getByTestId('draw-canvas').boundingBox())!;
	const coverBottom = (coverBox.y + coverBox.height - canvasBox.y) / canvasBox.height;
	expect(coverBottom).toBeGreaterThan(0.25);
	expect(coverBottom).toBeLessThan(0.33);
	// Undo cannot reach the head, and a tap in the head band is ignored.
	await expect(page.getByTestId('draw-undo')).toBeDisabled();
	await stroke(page, [0.4, 0.05], [0.6, 0.1]);
	await expect(page.getByTestId('draw-canvas')).toHaveAttribute('data-strokes', '1');
	await stroke(page, [0.4, 0.4], [0.5, 0.2]);
	await expect(page.getByTestId('draw-canvas')).toHaveAttribute('data-strokes', '2');
	const body = (await inkRows(page))!;
	expect(body.top).toBeLessThan(0.34); // the head is still on the board under the cover
	// Undo takes back this turn's stroke only.
	await page.getByTestId('draw-undo').click();
	await expect(page.getByTestId('draw-canvas')).toHaveAttribute('data-strokes', '1');
	await expect(page.getByTestId('draw-undo')).toBeDisabled();
	await page.getByTestId('draw-redo').click();
	await expect(page.getByTestId('draw-canvas')).toHaveAttribute('data-strokes', '2');
	await page.getByTestId('draw-monster-next').click();

	// Turn 3 (legs): last turn offers Reveal!, not Next player.
	await expect(page.getByTestId('draw-monster-status')).toContainText('draw the legs');
	await expect(page.getByTestId('draw-monster-next')).toHaveCount(0);
	await expect(page.getByTestId('draw-redo')).toBeDisabled();
	await stroke(page, [0.5, 0.7], [0.5, 0.95]);
	await expect(page.getByTestId('draw-canvas')).toHaveAttribute('data-strokes', '3');
	const all = (await inkRows(page))!;
	expect(all.bottom).toBeGreaterThan(0.9);
	const revealBtn = page.getByTestId('draw-monster-reveal');
	await expectTappable(revealBtn, 96);
	await revealBtn.click();
	await expect(cover).toHaveCount(0);
	await expect(page.getByTestId('draw-monster-tada')).toBeVisible();
	await expect(page.getByTestId('draw-monster-bar')).toHaveAttribute('data-phase', 'revealed');

	// The result saves and reopens like any drawing, and can be posted.
	await expect(page.getByTestId('draw-post')).toBeEnabled();
	await page.getByTestId('draw-save').click();
	await page.getByTestId('draw-author').filter({ hasText: name }).click();
	await expect(page.getByTestId('draw-note')).toHaveText('Saved!');
	await page.getByTestId('draw-browse').click();
	await page.getByRole('button', { name: `Open drawing by ${name}` }).click();
	await expect(page.getByTestId('draw-canvas')).toHaveAttribute('data-strokes', '3');
	await expect(page.getByTestId('draw-monster-bar')).toHaveCount(0);
	const reopened = (await inkRows(page))!;
	expect(reopened.top).toBeLessThan(0.34);
	expect(reopened.bottom).toBeGreaterThan(0.9);
	await page.getByTestId('draw-browse').click();
	await page.getByRole('button', { name: `Delete drawing by ${name}` }).click();
});

test('monster game with feet takes four turns; the controls fit at 4K', async ({ page }, info) => {
	seedKid(`e2e-monster-4k-${info.workerIndex}${info.repeatEachIndex}`, 'Kid Fit');
	await page.setViewportSize({ width: 3840, height: 2160 });
	await open(page);
	await page.getByTestId('draw-monster-feet').click();
	const band = page.getByTestId('draw-monster-band');
	await expect(band).toHaveAttribute('data-band-top', '0');
	for (const part of ['head', 'body', 'legs']) {
		await expect(page.getByTestId('draw-monster-status')).toContainText(`draw the ${part}`);
		await page.getByTestId('draw-monster-next').click();
	}
	await expect(page.getByTestId('draw-monster-status')).toContainText('draw the feet');
	await expect(page.getByTestId('draw-monster-reveal')).toBeVisible();
	const vp = page.viewportSize()!;
	for (const id of ['draw-monster-reveal', 'draw-monster-end']) {
		const box = (await page.getByTestId(id).boundingBox())!;
		expect(box.x).toBeGreaterThanOrEqual(0);
		expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
		expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
	}
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true
	);
	// Stop game uncovers everything at once.
	await page.getByTestId('draw-monster-end').click();
	await expect(page.getByTestId('draw-monster-cover')).toHaveCount(0);
	await expect(page.getByTestId('draw-monster-bar')).toHaveCount(0);
});
