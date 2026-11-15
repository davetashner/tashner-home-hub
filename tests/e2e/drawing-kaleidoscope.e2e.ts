import { reveal } from './drawing-sections';
import { expect, test, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { ensureHousehold } from './adult';
import { gotoHydrated } from './hydrated';
import { expectTappable } from './tap';
import { trackMember } from './cleanup';
import { DB_PATH } from './data-dir';

// hub-t27j.1: kaleidoscope mode repeats every stroke 6 or 8 ways around the board center.

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

/** Which quadrants (tl, tr, bl, br) of the canvas hold ink. */
const quadrants = (page: Page) =>
	page.getByTestId('draw-canvas').evaluate((c: HTMLCanvasElement) => {
		const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
		const hit = [false, false, false, false];
		for (let y = 0; y < c.height; y++)
			for (let x = 0; x < c.width; x++)
				if (d[(y * c.width + x) * 4 + 3] > 0)
					hit[(y < c.height / 2 ? 0 : 2) + (x < c.width / 2 ? 0 : 1)] = true;
		return hit;
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

/** Whether any ink sits near the point at `deg` degrees and 30% of the board height from the center. */
const inkAtAngle = (page: Page, deg: number) =>
	page.getByTestId('draw-canvas').evaluate((c: HTMLCanvasElement, a) => {
		const r = c.height * 0.3;
		const x = Math.round(c.width / 2 + r * Math.cos((a * Math.PI) / 180));
		const y = Math.round(c.height / 2 + r * Math.sin((a * Math.PI) / 180));
		const w = Math.round(c.height * 0.03);
		const d = c.getContext('2d')!.getImageData(x - w, y - w, 2 * w, 2 * w).data;
		for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;
		return false;
	}, deg);

/** A short stroke at `deg` degrees, 30% of the board height from the center. */
async function dotAt(page: Page, deg: number) {
	const { w, h } = await page
		.getByTestId('draw-canvas')
		.evaluate((c: HTMLCanvasElement) => ({ w: c.width, h: c.height }));
	const at = (a: number): [number, number] => [
		0.5 + (h * 0.3 * Math.cos((a * Math.PI) / 180)) / w,
		0.5 + (h * 0.3 * Math.sin((a * Math.PI) / 180)) / h
	];
	await stroke(page, at(deg - 1), at(deg + 1));
}

const inkCount = (page: Page) =>
	page.getByTestId('draw-canvas').evaluate((c: HTMLCanvasElement) => {
		const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
		let n = 0;
		for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
		return n;
	});

test('kaleidoscope repeats strokes around the center as one undo step @J18.20', async ({
	page
}, info) => {
	const kidId = `e2e-kaleido-kid-${info.workerIndex}${info.repeatEachIndex}`;
	seedKid(kidId, 'Kid Kaleido');
	await gotoHydrated(page, '/');
	await page.getByTestId('note-draw').click();
	await reveal(page, 'draw-kaleido');
	const btn = page.getByTestId('draw-kaleido');
	await expectTappable(btn, 96);
	await expect(btn).toHaveAttribute('data-kaleido', '0');

	// Off: one quadrant only.
	await stroke(page, [0.1, 0.1], [0.4, 0.3]);
	expect(await quadrants(page)).toEqual([true, false, false, false]);
	const plain = await inkCount(page);
	await page.getByTestId('draw-undo').click();

	// 6 slices: ink in all four quadrants, about six times the ink, one undo step.
	await btn.click();
	await expect(btn).toHaveAttribute('data-kaleido', '6');
	await expect(page.getByTestId('draw-mirror-guides')).toBeVisible();
	await expect(page.getByTestId('draw-mirror-guides').locator('line')).toHaveCount(3);
	await stroke(page, [0.1, 0.1], [0.4, 0.3]);
	await expect(page.getByTestId('draw-canvas')).toHaveAttribute('data-strokes', '1');
	expect(await quadrants(page)).toEqual([true, true, true, true]);
	expect(await inkCount(page)).toBeGreaterThan(plain * 3);
	await page.getByTestId('draw-undo').click();
	expect(await quadrants(page)).toEqual([false, false, false, false]);
	await page.getByTestId('draw-redo').click();
	expect(await quadrants(page)).toEqual([true, true, true, true]);
	await page.getByTestId('draw-undo').click();

	// The copies are radial: a dot at 0 degrees lands at 120 and 240, and nowhere else.
	await dotAt(page, 0);
	expect(await inkAtAngle(page, 0)).toBe(true);
	expect(await inkAtAngle(page, 120)).toBe(true);
	expect(await inkAtAngle(page, 240)).toBe(true);
	expect(await inkAtAngle(page, 60)).toBe(false);
	expect(await inkAtAngle(page, 90)).toBe(false);
	await page.getByTestId('draw-undo').click();

	// 8 slices, then off again stops the copies.
	await btn.click();
	await expect(btn).toHaveAttribute('data-kaleido', '8');
	await expect(page.getByTestId('draw-mirror-guides').locator('line')).toHaveCount(4);
	await stroke(page, [0.1, 0.1], [0.4, 0.3]);
	expect(await quadrants(page)).toEqual([true, true, true, true]);
	await page.getByTestId('draw-undo').click();
	await btn.click();
	await expect(btn).toHaveAttribute('data-kaleido', '0');
	await expect(page.getByTestId('draw-mirror-guides')).toHaveCount(0);
	await stroke(page, [0.1, 0.1], [0.4, 0.3]);
	expect(await quadrants(page)).toEqual([true, false, false, false]);
});

test('kaleidoscope and mirror switch each other off; the control fits at 4K', async ({
	page
}, info) => {
	seedKid(`e2e-kaleido-fit-${info.workerIndex}${info.repeatEachIndex}`, 'Kid Fit');
	await page.setViewportSize({ width: 3840, height: 2160 });
	await gotoHydrated(page, '/');
	await page.getByTestId('note-draw').click();
	await reveal(page, 'draw-kaleido');
	const k = page.getByTestId('draw-kaleido');
	const m = page.getByTestId('draw-mirror');
	await k.click();
	await m.click();
	await expect(k).toHaveAttribute('data-kaleido', '0');
	await expect(m).toHaveAttribute('data-mirror', '2');
	await k.click();
	await expect(m).toHaveAttribute('data-mirror', '0');
	const box = await k.boundingBox();
	const vp = page.viewportSize()!;
	expect(box!.x).toBeGreaterThanOrEqual(0);
	expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width);
	expect(box!.y + box!.height).toBeLessThanOrEqual(vp.height);
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true
	);
});

test('a kaleidoscope drawing saves and reopens with all its copies', async ({ page }, info) => {
	const name = `Kid Kaleido ${info.workerIndex}${info.repeatEachIndex}`;
	seedKid(`e2e-kaleido-save-${info.workerIndex}${info.repeatEachIndex}`, name);
	await gotoHydrated(page, '/');
	await page.getByTestId('note-draw').click();
	await reveal(page, 'draw-kaleido');
	await page.getByTestId('draw-kaleido').click();
	await stroke(page, [0.1, 0.1], [0.4, 0.3]);
	const ink = await inkCount(page);
	await page.getByTestId('draw-save').click();
	await page.getByTestId('draw-author').filter({ hasText: name }).click();
	await expect(page.getByTestId('draw-note')).toHaveText('Saved!');
	await page.getByTestId('draw-browse').click();
	await page.getByRole('button', { name: `Open drawing by ${name}` }).click();
	await expect(page.getByTestId('draw-canvas')).toHaveAttribute('data-strokes', '1');
	expect(await quadrants(page)).toEqual([true, true, true, true]);
	expect(Math.abs((await inkCount(page)) - ink)).toBeLessThan(ink * 0.05);
	await page.getByTestId('draw-browse').click();
	await page.getByRole('button', { name: `Delete drawing by ${name}` }).click();
});
