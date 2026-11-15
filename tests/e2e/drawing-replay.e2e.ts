import { reveal } from './drawing-sections';
import { expect, test, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { ensureHousehold } from './adult';
import { gotoHydrated } from './hydrated';
import { expectTappable } from './tap';
import { trackMember } from './cleanup';
import { DB_PATH } from './data-dir';

// hub-cn7.22: replay a saved drawing as a time-lapse. Runs in both wall orientations.

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

/** Opaque pixels on the canvas (it starts fully transparent over a paper-colored backdrop). */
const inkPixels = (page: Page) =>
	page.getByTestId('draw-canvas').evaluate((c: HTMLCanvasElement) => {
		const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
		let n = 0;
		for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
		return n;
	});

/** A pointer event stream on the canvas, like a pen or a finger would send. */
async function pointerStroke(
	page: Page,
	type: string,
	pressure: number,
	from: [number, number],
	to: [number, number],
	id: number
) {
	await page.getByTestId('draw-canvas').evaluate(
		(c, a) => {
			const r = c.getBoundingClientRect();
			const fire = (name: string, x: number, y: number) =>
				c.dispatchEvent(
					new PointerEvent(name, {
						pointerId: a.id,
						pointerType: a.type,
						pressure: a.pressure,
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
		{ type, pressure, from, to, id }
	);
}

test('make a time-lapse video of a saved drawing and get a download @J18.27', async ({
	page
}, info) => {
	test.setTimeout(60_000);
	const kidId = `e2e-draw-video-${info.workerIndex}${info.repeatEachIndex}`;
	const name = `Kid Video ${info.workerIndex}${info.repeatEachIndex}`;
	seedKid(kidId, name);
	try {
		await gotoHydrated(page, '/');
		await page.getByTestId('note-draw').click();
		await pointerStroke(page, 'touch', 0.5, [0.1, 0.3], [0.8, 0.6], 1);
		await pointerStroke(page, 'touch', 0.5, [0.1, 0.8], [0.8, 0.2], 2);
		await page.getByTestId('draw-save').click();
		await page.getByTestId('draw-author').filter({ hasText: name }).click();
		await expect(page.getByTestId('draw-note')).toHaveText('Saved!');
		await page.getByTestId('draw-browse').click();
		await page.getByRole('button', { name: `Replay drawing by ${name}` }).click();

		// No upload: no write request leaves the page while the video is made.
		const writes: string[] = [];
		page.on('request', (r) => {
			if (r.method() !== 'GET') writes.push(r.url());
		});
		const make = page.getByTestId('draw-video-make');
		await expectTappable(make, 96);
		// The controls fit inside the board at 4K and at the wall size.
		const wall = page.viewportSize()!;
		for (const size of [{ width: 3840, height: 2160 }, wall]) {
			await page.setViewportSize(size);
			const box = (await make.boundingBox())!;
			const holder = (await page.getByTestId('draw-holder').boundingBox())!;
			expect(box.x).toBeGreaterThanOrEqual(holder.x);
			expect(box.x + box.width).toBeLessThanOrEqual(holder.x + holder.width + 1);
			expect(box.y + box.height).toBeLessThanOrEqual(holder.y + holder.height + 1);
		}
		await make.click();
		await expect(make).toBeDisabled();
		const link = page.getByTestId('draw-video-download');
		await expect(link).toBeVisible({ timeout: 40_000 });
		await expectTappable(link, 96);
		await expect(link).toHaveAttribute('download', 'my-drawing.webm');
		const video = await link.evaluate(async (a: HTMLAnchorElement) => {
			const blob = await (await fetch(a.href)).blob();
			return { size: blob.size, type: blob.type, local: a.href.startsWith('blob:') };
		});
		expect(video.local).toBe(true);
		expect(video.type).toBe('video/webm');
		expect(video.size).toBeGreaterThan(1000);
		expect(video.size).toBeLessThan(8_000_000);
		expect(writes).toEqual([]);

		await page.getByTestId('draw-replay-skip').click();
		await expect(page.getByTestId('draw-replay')).toHaveCount(0);
		await page.getByTestId('draw-browse').click();
		await page.getByRole('button', { name: `Delete drawing by ${name}` }).click();
		await page.getByTestId('draw-mine-close').click();
		await page.getByTestId('draw-close').click();
	} finally {
		wipe(kidId);
	}
});

test('replay a saved drawing, tap to skip, and the save is untouched', async ({ page }, info) => {
	const kidId = `e2e-draw-replay-${info.workerIndex}${info.repeatEachIndex}`;
	const name = `Kid Replay ${info.workerIndex}${info.repeatEachIndex}`;
	seedKid(kidId, name);
	try {
		await gotoHydrated(page, '/');
		await page.getByTestId('note-draw').click();
		await pointerStroke(page, 'touch', 0.5, [0.1, 0.3], [0.8, 0.6], 1);
		await pointerStroke(page, 'touch', 0.5, [0.1, 0.8], [0.8, 0.2], 2);
		const ink = await inkPixels(page);
		await page.getByTestId('draw-save').click();
		await page.getByTestId('draw-author').filter({ hasText: name }).click();
		await expect(page.getByTestId('draw-note')).toHaveText('Saved!');
		await reveal(page, 'draw-clear');
		await page.getByTestId('draw-clear').click();
		expect(await inkPixels(page)).toBe(0);

		await page.getByTestId('draw-browse').click();
		const replay = page.getByRole('button', { name: `Replay drawing by ${name}` });
		await expectTappable(replay, 96);
		await replay.click();
		const player = page.getByTestId('draw-replay');
		await expect(player).toBeVisible();
		await expectTappable(page.getByTestId('draw-replay-speed'), 96);
		await expectTappable(page.getByTestId('draw-replay-skip'), 96);
		await page.getByTestId('draw-replay-speed').click();
		await expect(page.getByTestId('draw-replay-speed')).toHaveText('2x');

		// Part way through, there is less ink than the finished drawing.
		expect(await inkPixels(page)).toBeLessThan(ink);

		// Tapping the board skips to the end: the whole drawing, and the player is gone.
		await player.click({ position: { x: 200, y: 100 } });
		await expect(player).toHaveCount(0);
		expect(await inkPixels(page)).toBeGreaterThan(ink * 0.5);
		await expect(page.getByTestId('draw-canvas')).toHaveAttribute('data-strokes', '2');

		// The saved drawing is unchanged: still exactly one, and it replays again.
		await page.getByTestId('draw-browse').click();
		await expect(page.getByRole('button', { name: `Open drawing by ${name}` })).toHaveCount(1);
		await page.getByRole('button', { name: `Delete drawing by ${name}` }).click();
		await page.getByTestId('draw-mine-close').click();
		await page.getByTestId('draw-close').click();
	} finally {
		wipe(kidId);
	}
});
