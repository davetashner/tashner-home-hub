import { reveal } from './drawing-sections';
import { expect, test, type Locator, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { ensureHousehold } from './adult';
import { gotoHydrated } from './hydrated';
import { trackMember } from './cleanup';
import { DB_PATH } from './data-dir';
import { expectTappable } from './tap';

// hub-t27j.5 (J18.26): lasso some ink and make it swim, fly, bounce or launch.

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

type P = [number, number];

/** One pointer gesture on an element: down at the first point, moves, up at the last. Points are client px. */
async function gesture(target: Locator, pts: P[]) {
	await target.evaluate((el, pts) => {
		const fire = (name: string, [x, y]: [number, number]) =>
			el.dispatchEvent(
				new PointerEvent(name, {
					pointerId: 1,
					pointerType: 'pen',
					pressure: 0.8,
					isPrimary: true,
					button: 0,
					buttons: name === 'pointerup' ? 0 : 1,
					clientX: x,
					clientY: y,
					bubbles: true
				})
			);
		fire('pointerdown', pts[0]);
		for (const p of pts.slice(1)) fire('pointermove', p);
		fire('pointerup', pts[pts.length - 1]);
	}, pts);
}

/** Fractions of the canvas to client px. */
async function onCanvas(page: Page, pts: P[]): Promise<P[]> {
	const r = (await page.getByTestId('draw-canvas').boundingBox())!;
	return pts.map(([x, y]) => [r.x + x * r.width, r.y + y * r.height]);
}

const ink = async (page: Page, pts: P[]) =>
	gesture(page.getByTestId('draw-canvas'), await onCanvas(page, pts));

/** A closed rectangular loop drawn with the pen, in canvas fractions. */
// prettier-ignore
const loop = (page: Page, x0: number, y0: number, x1: number, y1: number) =>
	ink(page, [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]);

const along = (a: P, b: P, n = 8): P[] =>
	Array.from({ length: n + 1 }, (_, i) => [
		a[0] + ((b[0] - a[0]) * i) / n,
		a[1] + ((b[1] - a[1]) * i) / n
	]);

/** Bounding box of the ink (alpha > 0) between two canvas fractions of the width, in canvas pixels. */
const inkBox = (page: Page, from = 0, to = 1) =>
	page.getByTestId('draw-canvas').evaluate(
		(c: HTMLCanvasElement, [a, b]) => {
			const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
			let x0 = Infinity;
			let y0 = Infinity;
			let x1 = -1;
			let y1 = -1;
			for (let y = 0; y < c.height; y++)
				for (let x = Math.floor(a * c.width); x < Math.ceil(b * c.width); x++)
					if (d[(y * c.width + x) * 4 + 3] > 0) {
						x0 = Math.min(x0, x);
						y0 = Math.min(y0, y);
						x1 = Math.max(x1, x);
						y1 = Math.max(y1, y);
					}
			return { x0, y0, x1, y1 };
		},
		[from, to]
	);

const kidOf = (info: { workerIndex: number; repeatEachIndex: number }, tag = '') =>
	`e2e-animate-kid-${tag}${info.workerIndex}${info.repeatEachIndex}`;

const seedAndOpen = async (
	page: Page,
	info: { workerIndex: number; repeatEachIndex: number },
	tag = ''
) => {
	const name = `Kid Animate ${tag}${info.workerIndex}${info.repeatEachIndex}`;
	seedKid(kidOf(info, tag), name);
	await gotoHydrated(page, '/');
	await page.getByTestId('note-draw').click();
	return name;
};

const lassoOn = (page: Page) => page.getByTestId('draw-lasso').click();

const differs = (a: { x0: number; y0: number }, b: { x0: number; y0: number }, min: number) =>
	Math.abs(a.x0 - b.x0) + Math.abs(a.y0 - b.y0) >= min;

test('animate: lasso ink and make it swim, bounce, stop, undo, save, reopen and post it still @J18.31', async ({
	page
}, info) => {
	const name = await seedAndOpen(page, info);
	const canvas = page.getByTestId('draw-canvas');
	await expect(page.getByTestId('draw-motion-swim')).toHaveCount(0); // nothing selected yet

	// A long line on the left half and a short one on the right.
	await ink(page, along([0.05, 0.5], [0.3, 0.5]));
	await ink(page, along([0.8, 0.7], [0.95, 0.8]));
	const leftStill = await inkBox(page, 0, 0.6);
	const rightStill = await inkBox(page, 0.75, 1);

	await lassoOn(page);
	await loop(page, 0.02, 0.4, 0.35, 0.6);
	await expect(canvas).toHaveAttribute('data-lasso', '1');
	for (const m of ['swim', 'fly', 'bounce', 'launch', 'stop'])
		await expectTappable(page.getByTestId(`draw-motion-${m}`), 96);

	// Swim: the lassoed line moves, the other stays put, the points never change (Stop restores it).
	await page.getByTestId('draw-motion-swim').click();
	await expect(canvas).toHaveAttribute('data-animated', '1');
	await expect
		.poll(async () => differs(await inkBox(page, 0, 0.6), leftStill, 30), { timeout: 5000 })
		.toBe(true);
	expect(await inkBox(page, 0.75, 1)).toEqual(rightStill);

	// A second group with its own motion.
	await loop(page, 0.75, 0.6, 0.99, 0.9);
	await expect(canvas).toHaveAttribute('data-lasso', '1');
	await page.getByTestId('draw-motion-launch').click();
	await expect(canvas).toHaveAttribute('data-animated', '2');
	await expect
		.poll(async () => differs(await inkBox(page, 0.75, 1), rightStill, 60), { timeout: 5000 })
		.toBe(true);

	// Undo takes the launch off again, Redo puts it back; each is one step.
	await page.getByTestId('draw-undo').click();
	await expect(canvas).toHaveAttribute('data-animated', '1');
	await expect.poll(async () => await inkBox(page, 0.75, 1)).toEqual(rightStill);
	await page.getByTestId('draw-redo').click();
	await expect(canvas).toHaveAttribute('data-animated', '2');

	// Save, clear, reopen: both motions replay.
	await page.getByTestId('draw-save').click();
	await page.getByTestId('draw-author').filter({ hasText: name }).click();
	await expect(page.getByTestId('draw-note')).toHaveText('Saved!');
	await reveal(page, 'draw-clear');
	await page.getByTestId('draw-clear').click();
	await expect(canvas).toHaveAttribute('data-animated', '0');
	await page.getByTestId('draw-browse').click();
	await page.getByRole('button', { name: `Open drawing by ${name}` }).click();
	await expect(canvas).toHaveAttribute('data-strokes', '2');
	await expect(canvas).toHaveAttribute('data-animated', '2');
	await expect
		.poll(async () => differs(await inkBox(page, 0, 0.6), leftStill, 30), { timeout: 5000 })
		.toBe(true);

	// Posting exports the still frame: the left line sits where it was drawn, not mid-swim.
	await page.getByTestId('draw-post').click();
	await page.getByTestId('draw-author').filter({ hasText: name }).click();
	await expect(page.getByTestId('draw-sheet')).toHaveCount(0);
	const kidId = `e2e-animate-kid-${info.workerIndex}${info.repeatEachIndex}`;
	const notes = (await (await page.request.get('/api/notes')).json()) as {
		authorId: string;
		imageUrl: string | null;
	}[];
	const png = await page.request.get(notes.find((n) => n.authorId === kidId)!.imageUrl!);
	const url = `data:image/png;base64,${(await png.body()).toString('base64')}`;
	const spots = await page.evaluate(async (u) => {
		const img = new Image();
		img.src = u;
		await img.decode();
		const c = document.createElement('canvas');
		c.width = img.width;
		c.height = img.height;
		const g = c.getContext('2d')!;
		g.drawImage(img, 0, 0);
		const dark = (fx: number, fy: number) => {
			let n = 0;
			for (let dy = -3; dy <= 3; dy++) {
				const [r, gg, b] = g.getImageData(
					Math.round(fx * c.width),
					Math.round(fy * c.height) + dy,
					1,
					1
				).data;
				if (Math.max(r, gg, b) < 90) n++;
			}
			return n;
		};
		return [dark(0.1, 0.5), dark(0.17, 0.5), dark(0.28, 0.5)];
	}, url);
	expect(spots.every((n) => n > 0)).toBe(true);
	await page.getByTestId('note').filter({ hasText: name }).getByTestId('note-dismiss').click();

	await page.getByTestId('note-draw').click();
	await page.getByTestId('draw-browse').click();
	await page.getByRole('button', { name: `Delete drawing by ${name}` }).click();
	await expect(page.getByRole('button', { name: `Open drawing by ${name}` })).toHaveCount(0);
});

test('animate: Stop takes the motion off and the ink is back where it was drawn @J18.31', async ({
	page
}, info) => {
	await seedAndOpen(page, info);
	const canvas = page.getByTestId('draw-canvas');
	await ink(page, along([0.1, 0.5], [0.4, 0.5]));
	const still = await inkBox(page);
	await lassoOn(page);
	await loop(page, 0.05, 0.4, 0.45, 0.6);
	await page.getByTestId('draw-motion-bounce').click();
	await expect(canvas).toHaveAttribute('data-animated', '1');
	await expect
		.poll(async () => differs(await inkBox(page), still, 20), { timeout: 5000 })
		.toBe(true);
	await page.getByTestId('draw-motion-stop').click();
	await expect(canvas).toHaveAttribute('data-animated', '0');
	await expect.poll(async () => await inkBox(page)).toEqual(still);
	await page.waitForTimeout(400);
	expect(await inkBox(page)).toEqual(still); // no loop is running any more
});

test('animate: reduced motion keeps the ink still @J18.31', async ({ page }, info) => {
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await seedAndOpen(page, info);
	const canvas = page.getByTestId('draw-canvas');
	await ink(page, along([0.1, 0.5], [0.4, 0.5]));
	const still = await inkBox(page);
	await lassoOn(page);
	await loop(page, 0.05, 0.4, 0.45, 0.6);
	await page.getByTestId('draw-motion-launch').click();
	await expect(canvas).toHaveAttribute('data-animated', '1');
	await page.waitForTimeout(1200);
	expect(await inkBox(page)).toEqual(still);
});

test('animate: the motion buttons fit the 4K wall screen @J18.31', async ({ page }, info) => {
	await seedAndOpen(page, info);
	await ink(page, along([0.1, 0.5], [0.4, 0.5]));
	await lassoOn(page);
	await loop(page, 0.05, 0.4, 0.45, 0.6);
	await page.setViewportSize({ width: 3840, height: 2160 });
	const panel = (await page.getByTestId('draw-panel').boundingBox())!;
	for (const m of ['swim', 'fly', 'bounce', 'launch', 'stop']) {
		const b = (await page.getByTestId(`draw-motion-${m}`).boundingBox())!;
		expect(b.x).toBeGreaterThanOrEqual(panel.x);
		expect(b.x + b.width).toBeLessThanOrEqual(panel.x + panel.width);
		expect(b.y + b.height).toBeLessThanOrEqual(panel.y + panel.height);
		await expectTappable(page.getByTestId(`draw-motion-${m}`), 96);
	}
});

test('animate: animated ink still moves with Wiggle on, and a post stays still @J18.31', async ({
	page
}, info) => {
	const name = await seedAndOpen(page, info, 'w');
	const canvas = page.getByTestId('draw-canvas');
	await ink(page, along([0.05, 0.5], [0.3, 0.5]));
	const still = await inkBox(page);
	await lassoOn(page);
	await loop(page, 0.02, 0.4, 0.35, 0.6);
	await page.getByTestId('draw-motion-launch').click();
	await expect(canvas).toHaveAttribute('data-animated', '1');
	await reveal(page, 'draw-wiggle');
	await page.getByTestId('draw-wiggle').click();
	await expect(canvas).toHaveAttribute('data-wiggle', 'live');
	await expect
		.poll(async () => (await inkBox(page)).y0 < still.y0 - 100, { timeout: 5000 })
		.toBe(true);
	await page.getByTestId('draw-post').click();
	await page.getByTestId('draw-author').filter({ hasText: name }).click();
	await expect(page.getByTestId('draw-sheet')).toHaveCount(0);
	const kidId = kidOf(info, 'w');
	const notes = (await (await page.request.get('/api/notes')).json()) as {
		authorId: string;
		imageUrl: string | null;
	}[];
	const png = await page.request.get(notes.find((n) => n.authorId === kidId)!.imageUrl!);
	const url = `data:image/png;base64,${(await png.body()).toString('base64')}`;
	const rows = await page.evaluate(async (u) => {
		const img = new Image();
		img.src = u;
		await img.decode();
		const c = document.createElement('canvas');
		c.width = img.width;
		c.height = img.height;
		const g = c.getContext('2d')!;
		g.drawImage(img, 0, 0);
		const d = g.getImageData(0, 0, c.width, c.height).data;
		let top = c.height;
		for (let y = 0; y < c.height && top === c.height; y++)
			for (let x = 0; x < c.width; x++)
				if (
					Math.max(
						d[(y * c.width + x) * 4],
						d[(y * c.width + x) * 4 + 1],
						d[(y * c.width + x) * 4 + 2]
					) < 90
				) {
					top = y;
					break;
				}
		return top / c.height;
	}, url);
	expect(rows).toBeGreaterThan(0.4); // drawn at mid-height, not launched toward the top
});
