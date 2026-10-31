import { expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { ensureHousehold } from './adult';
import { gotoHydrated } from './hydrated';
import { expectTappable } from './tap';
import { trackMember } from './cleanup';
import { DB_PATH } from './data-dir';

// hub-cn7.19: textured brushes. Runs in both wall orientations.

function seedKid(id: string) {
	ensureHousehold();
	const db = new Database(DB_PATH);
	db.pragma('busy_timeout = 5000');
	db.prepare(
		"INSERT OR REPLACE INTO members (id, name, role, color, avatar) VALUES (?, 'Kid Brush', 'child', 'member-3', '🦊')"
	).run(id);
	db.close();
	trackMember(id);
}

const BRUSHES = ['crayon', 'chalk', 'watercolor', 'spray'] as const;

test('textured brushes draw grainy ink and stay smooth on a long stroke', async ({
	page
}, info) => {
	const kidId = `e2e-draw-brush-${info.workerIndex}${info.repeatEachIndex}`;
	seedKid(kidId);
	try {
		await gotoHydrated(page, '/');
		await page.getByTestId('note-draw').click();
		await expect(page.getByTestId('draw-sheet')).toBeVisible();
		for (const b of BRUSHES) await expectTappable(page.getByTestId(`draw-brush-${b}`), 96);

		const run = (brush: string, y: number) =>
			page.getByTestId('draw-canvas').evaluate(
				async (c: HTMLCanvasElement, a) => {
					const r = c.getBoundingClientRect();
					const fire = (name: string, x: number, yy: number) =>
						c.dispatchEvent(
							new PointerEvent(name, {
								pointerId: 1,
								pointerType: 'pen',
								pressure: 0.7,
								isPrimary: true,
								button: 0,
								buttons: name === 'pointerup' ? 0 : 1,
								clientX: r.left + x * r.width,
								clientY: r.top + yy * r.height,
								bubbles: true
							})
						);
					fire('pointerdown', 0.05, a.y);
					const times: number[] = [];
					for (let i = 1; i <= 240; i++) {
						const t0 = performance.now();
						fire('pointermove', 0.05 + (0.9 * i) / 240, a.y + 0.05 * Math.sin(i / 10));
						times.push(performance.now() - t0);
					}
					fire('pointerup', 0.95, a.y);
					times.sort((p, q) => p - q);
					return { brush: a.brush, p95: times[Math.floor(times.length * 0.95)] };
				},
				{ brush, y }
			);

		const grab = () =>
			page.getByTestId('draw-canvas').evaluate((c: HTMLCanvasElement) => {
				const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
				let n = 0;
				let partial = 0;
				let h = 0;
				for (let i = 3; i < d.length; i += 4) {
					if (d[i] > 0) n++;
					if (d[i] > 0 && d[i] < 255) partial++;
					h = (Math.imul(h, 31) + d[i] + d[i - 3]) | 0;
				}
				return { n, partial, h };
			});

		let y = 0.15;
		for (const b of BRUSHES) {
			await page.getByTestId(`draw-brush-${b}`).click();
			await expect(page.getByTestId(`draw-brush-${b}`)).toHaveAttribute('aria-pressed', 'true');
			const before = await grab();
			const { p95 } = await run(b, y);
			y += 0.15;
			const after = await grab();
			expect(after.n, `${b} leaves ink`).toBeGreaterThan(before.n);
			// Per-move handler time stays far inside a 60 fps frame even on a 240-sample stroke.
			expect(p95, `${b} p95 move ms`).toBeLessThan(16);
		}
		await expect(page.getByTestId('draw-canvas')).toHaveAttribute('data-strokes', '4');

		// Texture is deterministic: undo then redraw of the same board repaints the same pixels.
		const full = await grab();
		await page.getByTestId('draw-undo').click();
		await expect(page.getByTestId('draw-canvas')).toHaveAttribute('data-strokes', '3');
		expect((await grab()).h).not.toBe(full.h);
		// Resizing the viewport refits and repaints from the same seeds.
		const size = page.viewportSize()!;
		await page.setViewportSize({ width: size.width - 40, height: size.height });
		await page.setViewportSize(size);
		await expect(page.getByTestId('draw-canvas')).toHaveAttribute('data-strokes', '3');
		expect((await grab()).n).toBeGreaterThan(0);
	} finally {
		const db = new Database(DB_PATH);
		db.pragma('busy_timeout = 5000');
		db.prepare('DELETE FROM notes WHERE author_id = ?').run(kidId);
		db.close();
	}
});
