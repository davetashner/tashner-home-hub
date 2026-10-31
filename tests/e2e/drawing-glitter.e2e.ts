import { expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { ensureHousehold } from './adult';
import { gotoHydrated } from './hydrated';
import { expectTappable } from './tap';
import { trackMember } from './cleanup';
import { DB_PATH } from './data-dir';

// hub-cn7.20: glitter and rainbow pens. Runs in both wall orientations.

function seedKid(id: string) {
	ensureHousehold();
	const db = new Database(DB_PATH);
	db.pragma('busy_timeout = 5000');
	db.prepare(
		"INSERT OR REPLACE INTO members (id, name, role, color, avatar) VALUES (?, 'Kid Glitter', 'child', 'member-3', '🦊')"
	).run(id);
	db.close();
	trackMember(id);
}

test('rainbow cycles hue, glitter sparkles, both redraw identically and stay fast', async ({
	page
}, info) => {
	const kidId = `e2e-draw-glitter-${info.workerIndex}${info.repeatEachIndex}`;
	seedKid(kidId);
	try {
		await gotoHydrated(page, '/');
		await page.getByTestId('note-draw').click();
		await expect(page.getByTestId('draw-sheet')).toBeVisible();
		for (const b of ['glitter', 'rainbow'])
			await expectTappable(page.getByTestId(`draw-brush-${b}`), 96);

		const run = (y: number) =>
			page.getByTestId('draw-canvas').evaluate(async (c: HTMLCanvasElement, yy) => {
				const r = c.getBoundingClientRect();
				const fire = (name: string, x: number, y2: number) =>
					c.dispatchEvent(
						new PointerEvent(name, {
							pointerId: 1,
							pointerType: 'pen',
							pressure: 0.7,
							isPrimary: true,
							button: 0,
							buttons: name === 'pointerup' ? 0 : 1,
							clientX: r.left + x * r.width,
							clientY: r.top + y2 * r.height,
							bubbles: true
						})
					);
				fire('pointerdown', 0.05, yy);
				const times: number[] = [];
				for (let i = 1; i <= 240; i++) {
					const t0 = performance.now();
					fire('pointermove', 0.05 + (0.9 * i) / 240, yy + 0.05 * Math.sin(i / 10));
					times.push(performance.now() - t0);
				}
				fire('pointerup', 0.95, yy);
				times.sort((p, q) => p - q);
				return times[Math.floor(times.length * 0.95)];
			}, y);

		// Distinct hue buckets and near-white pixels in the canvas's opaque ink.
		const grab = () =>
			page.getByTestId('draw-canvas').evaluate((c: HTMLCanvasElement) => {
				const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
				const hues = new Set<number>();
				let n = 0;
				let bright = 0;
				let h = 0;
				for (let i = 0; i < d.length; i += 4) {
					h = (Math.imul(h, 31) + d[i + 3] + d[i]) | 0;
					if (d[i + 3] < 200) continue;
					n++;
					const [r, g, b] = [d[i], d[i + 1], d[i + 2]];
					const mx = Math.max(r, g, b);
					const mn = Math.min(r, g, b);
					if (mn > 235) bright++;
					if (mx - mn < 60 || mx < 90) continue;
					const hue =
						mx === r
							? ((g - b) / (mx - mn) + 6) % 6
							: mx === g
								? (b - r) / (mx - mn) + 2
								: (r - g) / (mx - mn) + 4;
					hues.add(Math.floor(hue));
				}
				return { n, hues: hues.size, bright, h };
			});

		await page.getByTestId('draw-brush-rainbow').click();
		await expect(page.getByTestId('draw-brush-rainbow')).toHaveAttribute('aria-pressed', 'true');
		const p1 = await run(0.25);
		const rainbow = await grab();
		expect(rainbow.n).toBeGreaterThan(0);
		expect(rainbow.hues, 'rainbow cycles through several hues').toBeGreaterThanOrEqual(4);

		await page.getByTestId('draw-brush-glitter').click();
		const p2 = await run(0.6);
		const both = await grab();
		expect(both.n).toBeGreaterThan(rainbow.n);
		expect(both.bright, 'glitter leaves bright sparkles').toBeGreaterThan(rainbow.bright);
		expect(Math.max(p1, p2), 'p95 move ms').toBeLessThan(16);
		await expect(page.getByTestId('draw-canvas')).toHaveAttribute('data-strokes', '2');

		// Undo then redo repaints the same pixels; so does a refit.
		await page.getByTestId('draw-undo').click();
		await expect(page.getByTestId('draw-canvas')).toHaveAttribute('data-strokes', '1');
		expect((await grab()).h).not.toBe(both.h);
		await page.getByTestId('draw-redo').click();
		await expect(page.getByTestId('draw-canvas')).toHaveAttribute('data-strokes', '2');
		expect((await grab()).h).toBe(both.h);
	} finally {
		const db = new Database(DB_PATH);
		db.pragma('busy_timeout = 5000');
		db.prepare('DELETE FROM notes WHERE author_id = ?').run(kidId);
		db.close();
	}
});
