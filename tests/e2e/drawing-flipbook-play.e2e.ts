import { expect, test, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { ensureHousehold } from './adult';
import { gotoHydrated } from './hydrated';
import { expectTappable } from './tap';
import { trackMember } from './cleanup';
import { DB_PATH } from './data-dir';

// hub-cn7.26: flipbook playback, and saving a flipbook to My drawings and reopening it.

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

const inkOn = (page: Page, testId: string) =>
	page.getByTestId(testId).evaluate((c: HTMLCanvasElement) => {
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

test('flipbook plays, stops on tap, and saves and reopens as a flipbook', async ({
	page
}, info) => {
	const name = `Kid Play ${info.workerIndex}${info.repeatEachIndex}`;
	seedKid(`e2e-flip-play-${info.workerIndex}${info.repeatEachIndex}`, name);
	await gotoHydrated(page, '/');
	await page.getByTestId('note-draw').click();
	await page.getByTestId('draw-flipbook').click();
	await expect(page.getByTestId('flip-play')).toBeDisabled();
	await stroke(page, [0.1, 0.1], [0.4, 0.3]);
	await page.getByTestId('flip-add').click();
	await stroke(page, [0.5, 0.5], [0.9, 0.8]);
	for (const id of ['flip-play', 'flip-speed']) await expectTappable(page.getByTestId(id), 96);
	await expect(page.getByTestId('flip-speed')).toHaveAttribute('data-speed', 'medium');
	await page.getByTestId('flip-speed').click();
	await expect(page.getByTestId('flip-speed')).toHaveAttribute('data-speed', 'fast');

	// Playing shows each frame in turn on the board; tapping the board stops it.
	await page.getByTestId('flip-play').click();
	const stop = page.getByTestId('flip-stop');
	await expect(stop).toBeVisible();
	const seen = new Set<number>();
	await expect
		.poll(async () => {
			seen.add(await inkOn(page, 'draw-canvas'));
			return seen.size;
		})
		.toBeGreaterThanOrEqual(2);
	await stop.click();
	await expect(stop).toHaveCount(0);
	await expect(page.getByTestId('draw-canvas')).toHaveAttribute('data-strokes', '1');

	// Save, wipe the frames, reopen: it comes back as a two-frame flipbook.
	await page.getByTestId('draw-save').click();
	await page.getByTestId('draw-author').filter({ hasText: name }).click();
	await expect(page.getByTestId('draw-note')).toHaveText('Saved!');
	await page.getByTestId('flip-frame').first().click();
	await page.getByTestId('flip-delete').click();
	await page.getByTestId('draw-browse').click();
	await page.getByRole('button', { name: `Open drawing by ${name}` }).click();
	await expect(page.getByTestId('flip-frame')).toHaveCount(2);
	await page.getByTestId('flip-frame').nth(1).click();
	await expect(page.getByTestId('draw-canvas')).toHaveAttribute('data-strokes', '1');

	await page.getByTestId('draw-browse').click();
	await page.getByRole('button', { name: `Delete drawing by ${name}` }).click();
	await expect(page.getByRole('button', { name: `Open drawing by ${name}` })).toHaveCount(0);
});
