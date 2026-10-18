import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { ensureHousehold, signInAsAdult } from './adult';
import { asWallDisplay } from './display';
import { expectTappable } from './tap';
import { syntheticJpeg } from '../../src/lib/server/photo-cache/fixtures';
import { gotoHydrated } from './hydrated';

// Page routes must see every request; a service worker would answer some from the real server.
test.use({ serviceWorkers: 'block' });
test.beforeAll(ensureHousehold);
// Idle behaviour is for wall displays (DEV-1); new browsers are personal.
test.beforeEach(({ context }) => asWallDisplay(context));

interface Photo {
	id: string;
	w: number;
	h: number;
	takenAt?: number | null;
	motion?: boolean;
}

/**
 * Serves this page its own synthetic photos and settings, so the shared test server's library
 * (other tests add and hide photos in parallel) never leaks in. Returns the photo ids requested.
 */
async function stubFrame(
	page: Page,
	photos: Photo[],
	settings: Record<string, unknown> = { intervalSeconds: 10, transition: 'kenburns' },
	random = 0.999
) {
	// The frame reshuffles every list; pinning Math.random fixes that order (0.999 keeps it as served).
	await page.addInitScript((r) => {
		Math.random = () => r;
	}, random);
	const tall = await syntheticJpeg(360, 640);
	const wide = await syntheticJpeg(640, 360);
	const requested: string[] = [];
	await page.route(/\/api\/photo\/[^/?]+\?/, (route) => {
		const url = new URL(route.request().url());
		const id = decodeURIComponent(url.pathname.split('/').pop()!);
		const photo = photos.find((p) => p.id === id);
		if (!photo) return route.fallback();
		requested.push(id);
		const portrait = Number(url.searchParams.get('h')) > Number(url.searchParams.get('w'));
		// Like the server: a backdrop only exists when the photo's shape differs from the screen's.
		if (url.searchParams.get('part') === 'bg' && photo.h > photo.w === portrait)
			return route.fulfill({ status: 404 });
		return route.fulfill({ contentType: 'image/jpeg', body: photo.h > photo.w ? tall : wide });
	});
	await page.route('**/api/photo/slideshow?**', (route) => route.fulfill({ json: photos }));
	await page.route('**/api/settings/slideshow', (route) =>
		route.request().method() === 'GET' ? route.fulfill({ json: settings }) : route.fallback()
	);
	return requested;
}

const isPortrait = (page: Page) => {
	const v = page.viewportSize()!;
	return v.height > v.width;
};

test('the slideshow plays on the interval, preloads, and fills both photo shapes @J8.2', async ({
	page
}, info) => {
	const tall = { id: `${info.project.name}-tall`, w: 360, h: 640 };
	const wide = { id: `${info.project.name}-wide`, w: 640, h: 360 };
	const requested = await stubFrame(page, [tall, wide]);
	await page.clock.install();
	await gotoHydrated(page, '/photos');

	const frame = page.getByTestId('slideshow');
	const front = frame.locator('[data-front="true"]');
	await expect(front).toHaveAttribute('data-photo-id', tall.id);
	await expect(frame).toHaveAttribute('data-transition', 'kenburns');
	await expect(front.locator('.kenburns')).toHaveCSS('animation-name', /kenburns/);
	// A portrait photo on a landscape screen sits on a blurred copy of itself, never cropped.
	await expect(front.locator('[data-part="bg"]')).toHaveCount(isPortrait(page) ? 0 : 1);
	await expect(front.locator('[data-part="main"]')).toHaveCSS('object-fit', 'contain');
	// The next photo is downloaded before its turn, so the change never shows a blank.
	await expect.poll(() => requested).toContain(wide.id);

	await page.clock.fastForward(9_000);
	await expect(front).toHaveAttribute('data-photo-id', tall.id);
	await page.clock.fastForward(1_000);
	await expect(front).toHaveAttribute('data-photo-id', wide.id);
	await expect(front.locator('[data-part="bg"]')).toHaveCount(isPortrait(page) ? 1 : 0);
	// The previous photo stays fully visible underneath while the new one fades in.
	await expect(frame.locator(`[data-photo-id="${tall.id}"]`)).toHaveCSS('opacity', '1');

	await page.clock.fastForward(10_000);
	await expect(front).toHaveAttribute('data-photo-id', tall.id);

	// Opened from the nav, the slideshow stays inside the shell so the nav still works.
	await page
		.getByRole('navigation', { name: 'Main' })
		.getByRole('link', { name: 'Calendar' })
		.click();
	await expect(page).toHaveURL(/\/calendar$/);
});

test('each start reshuffles, so the frame does not always open on the same photo @J8.2', async ({
	page
}, info) => {
	const a = { id: `${info.project.name}-first`, w: 640, h: 360 };
	const b = { id: `${info.project.name}-second`, w: 640, h: 360 };
	// Math.random() = 0 swaps a two-photo list: the photo served second opens the show.
	await stubFrame(page, [a, b], { intervalSeconds: 600, transition: 'fade' }, 0);
	await gotoHydrated(page, '/photos');
	await expect(page.getByTestId('slideshow').locator('[data-front="true"]')).toHaveAttribute(
		'data-photo-id',
		b.id
	);
});

test('the idle photo frame covers the whole screen; a touch goes back @J8.1', async ({
	page
}, info) => {
	await stubFrame(page, [{ id: `${info.project.name}-idle`, w: 640, h: 360 }], {
		intervalSeconds: 30,
		transition: 'fade'
	});
	await page.route('**/api/settings/idle', (route) =>
		route.request().method() === 'GET'
			? route.fulfill({ json: { homeMinutes: 0, frameMinutes: 1 } })
			: route.fallback()
	);
	await page.clock.install();
	await gotoHydrated(page, '/lists');
	await page.waitForLoadState('networkidle');
	await page.clock.fastForward(60_000);
	await expect(page).toHaveURL(/\/photos$/);

	const frame = page.getByTestId('slideshow');
	await expect(frame.locator('[data-front="true"]')).toHaveAttribute(
		'data-photo-id',
		`${info.project.name}-idle`
	);
	const v = page.viewportSize()!;
	expect(await frame.boundingBox()).toEqual({ x: 0, y: 0, width: v.width, height: v.height });

	// A tap where the nav would be only wakes the screen.
	const box = (await page
		.getByRole('navigation', { name: 'Main' })
		.getByRole('link', { name: 'Calendar' })
		.boundingBox())!;
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
	await expect(page).toHaveURL(/\/lists$/);
});

test('an empty library explains how to add photos @J8.7', async ({ page }) => {
	await stubFrame(page, []);
	await gotoHydrated(page, '/photos');
	await expect(page.getByText('No photos to show yet')).toBeVisible();
});

test('grown-ups set the photo interval and transition @J8.7', async ({ page }) => {
	await page.route('**/api/settings/slideshow', (route) =>
		route.request().method() === 'GET'
			? route.fulfill({ json: { intervalSeconds: 30, transition: 'fade' } })
			: route.fallback()
	);
	const saved: unknown[] = [];
	await page.route('**/api/settings/slideshow', (route) => {
		if (route.request().method() !== 'PUT') return route.fallback();
		saved.push(route.request().postDataJSON());
		return route.fulfill({ json: { intervalSeconds: 45, transition: 'kenburns' } });
	});
	await signInAsAdult(page, 'e2e-slideshow-adult');
	await gotoHydrated(page, '/settings/screen');
	await expect(page.getByTestId('interval')).toHaveText('30 seconds');

	const more = page.getByRole('button', { name: 'Next photo: more' });
	await expectTappable(more);
	await expectTappable(page.getByRole('button', { name: 'Next photo: less' }));
	await more.click();
	await expect(page.getByTestId('interval')).toHaveText('45 seconds');

	const zoom = page.getByRole('button', { name: 'Slow zoom' });
	await expectTappable(zoom);
	await zoom.click();
	await expect(zoom).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByRole('button', { name: 'Fade' })).toHaveAttribute('aria-pressed', 'false');
	await expect.poll(() => saved).toEqual([{ intervalSeconds: 45 }, { transition: 'kenburns' }]);
});

/** Holds the primary pointer still on the photo long enough to count as a long-press. */
async function longPress(page: Page, holdMs = 800) {
	const box = (await page.getByTestId('slideshow').boundingBox())!;
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.waitForTimeout(holdMs);
	await page.mouse.up();
}

test('a grown-up long-presses a photo to hide it from the slideshow @J8.7', async ({
	page
}, info) => {
	const a = { id: `${info.project.name}-keep`, w: 640, h: 360 };
	const b = { id: `${info.project.name}-hide`, w: 640, h: 360 };
	await stubFrame(page, [b, a], { intervalSeconds: 600, transition: 'fade' });
	const hidden: unknown[] = [];
	await page.route(/\/api\/photo\/[^/]+\/hide$/, (route) => {
		hidden.push([route.request().url(), route.request().postDataJSON()]);
		return route.fulfill({ json: { hidden: true } });
	});
	await signInAsAdult(page, `e2e-hide-${info.project.name}`);
	await gotoHydrated(page, '/photos');

	const frame = page.getByTestId('slideshow');
	const front = frame.locator('[data-front="true"]');
	await expect(front).toHaveAttribute('data-photo-id', b.id);
	const sheet = page.getByRole('dialog', { name: 'Hide this photo?' });

	// A short press does nothing; Cancel leaves the photo alone.
	await longPress(page, 100);
	await expect(sheet).toHaveCount(0);
	await longPress(page);
	await expect(sheet).toBeVisible();
	await expectTappable(sheet.getByRole('button', { name: 'Cancel' }));
	await sheet.getByRole('button', { name: 'Cancel' }).click();
	await expect(sheet).toHaveCount(0);
	expect(hidden).toEqual([]);
	await expect(front).toHaveAttribute('data-photo-id', b.id);

	// Hiding moves on to the next photo at once and saves the flag.
	await longPress(page);
	const hide = sheet.getByRole('button', { name: 'Hide this photo' });
	await expectTappable(hide);
	await hide.click();
	await expect(front).toHaveAttribute('data-photo-id', a.id);
	await expect
		.poll(() => hidden)
		.toEqual([[expect.stringContaining(`/${b.id}/hide`), { hidden: true }]]);
});

test('long-pressing without an adult session asks for the PIN first @J8.7', async ({
	page
}, info) => {
	await stubFrame(page, [{ id: `${info.project.name}-locked`, w: 640, h: 360 }], {
		intervalSeconds: 600,
		transition: 'fade'
	});
	await gotoHydrated(page, '/photos');
	await expect(page.getByTestId('slideshow').locator('[data-front="true"]')).toBeVisible();
	await expect(async () => {
		await longPress(page);
		await expect(page).toHaveURL(/\/unlock\?next=%2Fphotos/, { timeout: 1_000 });
	}).toPass();
});

/** Taken `years` ago, `days` from today, on the photographer's clock (UTC fields). */
const takenNear = (years: number, days = 0) => {
	const d = new Date();
	return Date.UTC(d.getFullYear() - years, d.getMonth(), d.getDate() + days, 12);
};

test('on this day: favor puts past-year photos every third slide with a caption @J8.4', async ({
	page
}, info) => {
	const p = info.project.name;
	const other = (n: number) => ({
		id: `${p}-other${n}`,
		w: 640,
		h: 360,
		takenAt: takenNear(1, 90)
	});
	const match = (n: number, years: number) => ({
		id: `${p}-match${n}`,
		w: 640,
		h: 360,
		takenAt: takenNear(years, 2)
	});
	const photos = [other(0), other(1), other(2), other(3), match(0, 3), match(1, 1)];
	await stubFrame(page, photos, { intervalSeconds: 10, transition: 'fade', onThisDay: 'favor' });
	await page.clock.install();
	await gotoHydrated(page, '/photos');

	const frame = page.getByTestId('slideshow');
	const front = frame.locator('[data-front="true"]');
	const caption = front.getByTestId('on-this-day-caption');
	const order = [other(0), other(1), match(0, 3), other(2), other(3), match(1, 1)];
	for (const [i, photo] of order.entries()) {
		if (i > 0) await page.clock.fastForward(10_000);
		await expect(front).toHaveAttribute('data-photo-id', photo.id);
		if (photo.id.includes('match'))
			await expect(caption).toHaveText(
				photo.id.endsWith('0') ? '3 years ago this week' : '1 year ago this week'
			);
		else await expect(caption).toHaveCount(0);
	}
});

test('on this day: only shows the matches @J8.4', async ({ page }, info) => {
	const p = info.project.name;
	const matches = Array.from({ length: 10 }, (_, i) => ({
		id: `${p}-day${i}`,
		w: 640,
		h: 360,
		takenAt: takenNear(2, 0)
	}));
	const other = { id: `${p}-elsewhere`, w: 640, h: 360, takenAt: takenNear(2, 60) };
	const requested = await stubFrame(page, [other, ...matches], {
		intervalSeconds: 10,
		transition: 'fade',
		onThisDay: 'only'
	});
	await page.clock.install();
	await gotoHydrated(page, '/photos');
	const front = page.getByTestId('slideshow').locator('[data-front="true"]');
	await expect(front).toHaveAttribute('data-photo-id', matches[0].id);
	await expect(front.getByTestId('on-this-day-caption')).toHaveText('2 years ago today');
	for (const m of matches.slice(1, 4)) {
		await page.clock.fastForward(10_000);
		await expect(front).toHaveAttribute('data-photo-id', m.id);
	}
	expect(requested).not.toContain(other.id);
});

test('on this day: too few matches falls back to every photo @J8.4', async ({ page }, info) => {
	const p = info.project.name;
	const match = { id: `${p}-few-match`, w: 640, h: 360, takenAt: takenNear(2, 0) };
	const other = { id: `${p}-few-other`, w: 640, h: 360, takenAt: takenNear(2, 60) };
	await stubFrame(page, [other, match], {
		intervalSeconds: 10,
		transition: 'fade',
		onThisDay: 'only'
	});
	await page.clock.install();
	await gotoHydrated(page, '/photos');
	const front = page.getByTestId('slideshow').locator('[data-front="true"]');
	await expect(front).toHaveAttribute('data-photo-id', other.id);
	await expect(front.getByTestId('on-this-day-caption')).toHaveCount(0);
	await page.clock.fastForward(10_000);
	await expect(front).toHaveAttribute('data-photo-id', match.id);
	await expect(front.getByTestId('on-this-day-caption')).toHaveText('2 years ago today');
});

test('grown-ups choose the on this day mode @J8.4', async ({ page }) => {
	await page.route('**/api/settings/slideshow', (route) =>
		route.request().method() === 'GET'
			? route.fulfill({
					json: { intervalSeconds: 30, transition: 'fade', onThisDay: 'off' }
				})
			: route.fallback()
	);
	const saved: unknown[] = [];
	await page.route('**/api/settings/slideshow', (route) => {
		if (route.request().method() !== 'PUT') return route.fallback();
		saved.push(route.request().postDataJSON());
		return route.fulfill({ json: {} });
	});
	await signInAsAdult(page, 'e2e-on-this-day-adult');
	await gotoHydrated(page, '/settings/screen');
	const group = page.getByRole('group', { name: 'On this day' });
	await expect(group.getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'true');
	for (const name of ['Favor', 'Only']) await expectTappable(group.getByRole('button', { name }));
	await group.getByRole('button', { name: 'Favor' }).click();
	await expect(group.getByRole('button', { name: 'Favor' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await group.getByRole('button', { name: 'Only' }).click();
	await expect.poll(() => saved).toEqual([{ onThisDay: 'favor' }, { onThisDay: 'only' }]);
});

// A 1 s, 64x36 solid-colour WebM (under 1 KB): the tiniest clip Chromium plays without H.264.
const clip = readFileSync(new URL('./fixtures/clip.webm', import.meta.url));

/** Stubs the Live Photo clip route; returns the requests made. */
async function stubClip(page: Page, status = 200) {
	const requested: string[] = [];
	await page.route(/\/api\/photo\/[^/?]+\/motion$/, (route) => {
		requested.push(route.request().url());
		return status === 200
			? route.fulfill({ contentType: 'video/webm', body: clip })
			: route.fulfill({ status });
	});
	return requested;
}

const live = { intervalSeconds: 600, transition: 'kenburns', livePhotos: 'on' };

test('a Live Photo plays its clip once over the still, then holds on the still', async ({
	page
}, info) => {
	const photo = { id: `${info.project.name}-live`, w: 640, h: 360, motion: true };
	await stubFrame(page, [photo], live);
	await stubClip(page);
	await gotoHydrated(page, '/photos');

	const front = page.getByTestId('slideshow').locator('[data-front="true"]');
	const video = front.getByTestId('live-clip');
	await expect(front.locator('[data-part="main"]')).toBeVisible();
	await expect(video).toHaveAttribute('data-visible', 'true');
	await expect(video).toHaveJSProperty('muted', true);
	await expect(front.locator('video')).toHaveCount(1);
	// Played once: the element goes away after it ends and the still is all that is left.
	await expect(video).toHaveCount(0, { timeout: 10_000 });
	await expect(front.locator('[data-part="main"]')).toBeVisible();
	await expect(front).toHaveAttribute('data-photo-id', photo.id);
});

test('with Live Photos off, or no clip, no video is loaded', async ({ page }, info) => {
	const photo = { id: `${info.project.name}-off`, w: 640, h: 360, motion: true };
	await stubFrame(page, [photo], { ...live, livePhotos: 'off' });
	const requested = await stubClip(page);
	await gotoHydrated(page, '/photos');
	await expect(page.locator('[data-part="main"]')).toBeVisible();
	await page.waitForTimeout(1500);
	await expect(page.locator('video')).toHaveCount(0);
	expect(requested).toEqual([]);
});

test('a clip that fails to load leaves the still alone', async ({ page }, info) => {
	const photo = { id: `${info.project.name}-broken`, w: 640, h: 360, motion: true };
	await stubFrame(page, [photo], live);
	const requested = await stubClip(page, 500);
	await gotoHydrated(page, '/photos');
	await expect.poll(() => requested.length).toBeGreaterThan(0);
	await expect(page.locator('video')).toHaveCount(0, { timeout: 5_000 });
	await expect(page.locator('[data-front="true"] [data-part="main"]')).toBeVisible();
});

test('grown-ups turn Live Photos on in Settings, Screen', async ({ page }) => {
	await page.route('**/api/settings/slideshow', (route) =>
		route.request().method() === 'GET'
			? route.fulfill({ json: { intervalSeconds: 30, transition: 'fade', livePhotos: 'off' } })
			: route.fallback()
	);
	const saved: unknown[] = [];
	await page.route('**/api/settings/slideshow', (route) => {
		if (route.request().method() !== 'PUT') return route.fallback();
		saved.push(route.request().postDataJSON());
		return route.fulfill({ json: { intervalSeconds: 30, transition: 'fade', livePhotos: 'on' } });
	});
	await signInAsAdult(page, 'e2e-live-photos-adult');
	await gotoHydrated(page, '/settings/screen');
	const group = page.getByRole('group', { name: 'Play Live Photos' });
	await expect(group.getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'true');
	const on = group.getByRole('button', { name: 'On' });
	await expectTappable(on);
	await on.click();
	await expect(on).toHaveAttribute('aria-pressed', 'true');
	await expect.poll(() => saved).toEqual([{ livePhotos: 'on' }]);
});
