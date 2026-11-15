import { reveal } from './drawing-sections';
import { expect, test, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { ensureHousehold } from './adult';
import { gotoHydrated } from './hydrated';
import { expectTappable } from './tap';
import { trackMember } from './cleanup';
import { DB_PATH } from './data-dir';

// hub-t27j.4: Wiggle makes the lines boil like a cartoon; stored strokes never change.

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

/** The canvas pixels as one string, so two looks can be compared. */
const look = (page: Page) =>
	page.getByTestId('draw-canvas').evaluate((c: HTMLCanvasElement) => c.toDataURL());

/** Every distinct look the canvas shows over `ms`. */
async function looksOver(page: Page, ms: number) {
	const seen = new Set<string>();
	const end = Date.now() + ms;
	while (Date.now() < end) {
		seen.add(await look(page));
		await page.waitForTimeout(40);
	}
	return seen.size;
}

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

test('wiggle boils the lines, stays out of the strokes, and saves with the drawing @J18.30', async ({
	page
}, info) => {
	const kidId = `e2e-wiggle-kid-${info.workerIndex}${info.repeatEachIndex}`;
	const name = `Kid Wiggle ${info.workerIndex}${info.repeatEachIndex}`;
	seedKid(kidId, name);
	try {
		await gotoHydrated(page, '/');
		await page.getByTestId('note-draw').click();
		const canvas = page.getByTestId('draw-canvas');
		await stroke(page, [0.1, 0.2], [0.8, 0.6]);
		await stroke(page, [0.1, 0.7], [0.8, 0.3]);

		await reveal(page, 'draw-wiggle');
		const btn = page.getByTestId('draw-wiggle');
		await expectTappable(btn, 96);
		await expect(btn).toHaveAttribute('aria-pressed', 'false');
		await expect(canvas).toHaveAttribute('data-wiggle', 'off');

		// Off: nothing animates.
		expect(await looksOver(page, 700)).toBe(1);

		// On: the lines boil (several looks), the stroke count does not change.
		await btn.click();
		await expect(canvas).toHaveAttribute('data-wiggle', 'live');
		expect(await looksOver(page, 1200)).toBeGreaterThanOrEqual(2);
		await expect(canvas).toHaveAttribute('data-strokes', '2');

		// New ink while wiggling is one undo step; Undo takes it away and wiggle carries on.
		await stroke(page, [0.2, 0.5], [0.7, 0.5]);
		await expect(canvas).toHaveAttribute('data-strokes', '3');
		await page.getByTestId('draw-undo').click();
		await expect(canvas).toHaveAttribute('data-strokes', '2');
		await expect(canvas).toHaveAttribute('data-wiggle', 'live');

		// Off again: back to the exact strokes as drawn, and still.
		await btn.click();
		await expect(canvas).toHaveAttribute('data-wiggle', 'off');
		expect(await looksOver(page, 500)).toBe(1);
		const plain = await inkPixels(page);

		// Save with wiggle on, clear, reopen: wiggle is back on and the strokes are as drawn.
		await btn.click();
		await page.getByTestId('draw-save').click();
		await page.getByTestId('draw-author').filter({ hasText: name }).click();
		await expect(page.getByTestId('draw-note')).toHaveText('Saved!');
		await btn.click();
		await reveal(page, 'draw-clear');
		await page.getByTestId('draw-clear').click();
		expect(await inkPixels(page)).toBe(0);
		await reveal(page, 'draw-wiggle');
		await expect(btn).toHaveAttribute('aria-pressed', 'false');
		await page.getByTestId('draw-browse').click();
		await page.getByRole('button', { name: `Open drawing by ${name}` }).click();
		await expect(canvas).toHaveAttribute('data-strokes', '2');
		await expect(btn).toHaveAttribute('aria-pressed', 'true');
		await expect(canvas).toHaveAttribute('data-wiggle', 'live');
		await btn.click();
		// Saved coordinates are rounded, so compare ink amount rather than exact pixels.
		expect(Math.abs((await inkPixels(page)) - plain)).toBeLessThan(plain * 0.03);

		// The control fits at the 4K monitor's scale 1 as well.
		const wall = page.viewportSize();
		await page.setViewportSize({ width: 3840, height: 2160 });
		const box = await btn.boundingBox();
		expect(box && box.x >= 0 && box.x + box.width <= 3840).toBe(true);
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= 3840)).toBe(true);
		if (wall) await page.setViewportSize(wall);

		await page.getByTestId('draw-browse').click();
		await page.getByRole('button', { name: `Delete drawing by ${name}` }).click();
		await page.getByTestId('draw-mine-close').click();
	} finally {
		wipe(kidId);
	}
});

test('wiggle holds still for reduced motion @J18.30', async ({ page }) => {
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await gotoHydrated(page, '/');
	await page.getByTestId('note-draw').click();
	await stroke(page, [0.1, 0.2], [0.8, 0.6]);
	await reveal(page, 'draw-wiggle');
	await page.getByTestId('draw-wiggle').click();
	const canvas = page.getByTestId('draw-canvas');
	await expect(canvas).toHaveAttribute('data-wiggle', 'still');
	expect(await looksOver(page, 700)).toBe(1);
});

// hub-t27j.21: a drawing posted with Wiggle on boils in its note tile and when enlarged.
async function postFrom(page: Page, name: string, wiggle: boolean) {
	await gotoHydrated(page, '/');
	await page.getByTestId('note-draw').click();
	await stroke(page, [0.1, 0.2], [0.8, 0.6]);
	if (wiggle) {
		await reveal(page, 'draw-wiggle');
		await page.getByTestId('draw-wiggle').click();
	}
	await page.getByTestId('draw-post').click();
	await page.getByTestId('draw-author').filter({ hasText: name }).click();
}

test('a posted wiggle drawing boils on the board and enlarged; plain stays still @J18.39', async ({
	page
}, info) => {
	const kidId = `e2e-wiggle-post-${info.workerIndex}${info.repeatEachIndex}`;
	const name = `Kid WigglePost ${info.workerIndex}${info.repeatEachIndex}`;
	seedKid(kidId, name);
	try {
		await postFrom(page, name, true);
		const tile = page.getByTestId('note').filter({ hasText: name });
		const boil = tile.getByTestId('wiggle-img');
		await expect(boil).toHaveAttribute('data-wiggle', 'live');
		await expect(boil.locator('img')).toHaveCount(3);
		const seen = new Set<string | null>();
		const end = Date.now() + 1500;
		while (Date.now() < end) {
			seen.add(await boil.getAttribute('data-frame'));
			await page.waitForTimeout(30);
		}
		expect(seen.size).toBe(3);

		// Survives a reload (served from the server), and boils enlarged too.
		await page.reload();
		await gotoHydrated(page, '/');
		await tile.getByTestId('note-image').click();
		const zoomed = page.getByTestId('note-zoom').getByTestId('wiggle-img');
		await expect(zoomed).toHaveAttribute('data-wiggle', 'live');
		await expect(zoomed.locator('img')).toHaveCount(3);
		await page.getByTestId('note-zoom-close').click();
		await tile.getByTestId('note-dismiss').click();

		// Posted without Wiggle: a single still image.
		await postFrom(page, name, false);
		await expect(tile.getByTestId('note-image')).toBeVisible();
		await expect(tile.getByTestId('wiggle-img')).toHaveCount(0);
	} finally {
		wipe(kidId);
	}
});

test('a posted wiggle drawing holds still for reduced motion @J18.39', async ({ page }, info) => {
	const kidId = `e2e-wiggle-rm-${info.workerIndex}${info.repeatEachIndex}`;
	const name = `Kid WiggleRM ${info.workerIndex}${info.repeatEachIndex}`;
	seedKid(kidId, name);
	try {
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await postFrom(page, name, true);
		const boil = page.getByTestId('note').filter({ hasText: name }).getByTestId('wiggle-img');
		await expect(boil).toHaveAttribute('data-wiggle', 'still');
		await page.waitForTimeout(700);
		await expect(boil).toHaveAttribute('data-frame', '0');
	} finally {
		wipe(kidId);
	}
});
