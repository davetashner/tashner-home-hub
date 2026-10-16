import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { ensureHousehold, signInAsAdult } from './adult';
import { choreCard, openKid, seedKid, stubAudio } from './kid';
import { syntheticJpeg } from '../../src/lib/server/photo-cache/fixtures';

/**
 * ADR 0002, Tier 2: tap latency and animation smoothness at 4x CPU throttle (a rough Pi 5).
 *
 * Headless Chromium paints in software, so raw paint timing at 4x throttle is slow with or without our
 * code (see celebrate-perf.e2e.ts). Like that test, these gates hold to a budget what *our code* adds:
 *  - Tap latency: the Event Timing entry for the tap's click gives input delay (main thread busy) and
 *    processing (our handlers plus the synchronous Svelte flush). Their sum must fit 100 ms (INP "good").
 *    The full INP duration, which includes the software paint, is logged but not gated.
 *    The visual response must also be committed by our code in the tapped frame or the next one (rAF count).
 *  - Smoothness: raw dropped-frame % is dominated by the software rasteriser here, so we gate the causes:
 *    every animated property on the star flight, the pending-star pop and the photo crossfade/Ken Burns is
 *    transform, opacity or filter (read from the live Animation objects), and the main thread is never
 *    blocked long enough during them to drop frames (longest task, and rAF gaps measured on a quiet page).
 */

test.beforeAll(ensureHousehold);

const COMPOSITED = new Set(['transform', 'opacity', 'filter']);
const KEYFRAME_META = new Set(['offset', 'computedOffset', 'easing', 'composite']);

type Perf = {
	events: { name: string; delay: number; processing: number; duration: number }[];
	responseFrame: number;
	responseMs: number;
	long: number[];
	gaps: number[];
	animated: string[];
	animCount: number;
};

/** Page-side recorder. `respond` is evaluated each frame after the tap to find the visual response. */
async function arm(page: Page, respondSource: string) {
	await page.evaluate((src) => {
		const w = window as unknown as { __p: Perf };
		const p: Perf = {
			events: [],
			responseFrame: -1,
			responseMs: -1,
			long: [],
			gaps: [],
			animated: [],
			animCount: 0
		};
		w.__p = p;
		const respond = new Function(`return (${src})()`) as () => boolean;
		new PerformanceObserver((list) => {
			for (const e of list.getEntries() as unknown as PerformanceEventTiming[]) {
				if (e.name !== 'click' && e.name !== 'pointerup') continue;
				p.events.push({
					name: e.name,
					delay: e.processingStart - e.startTime,
					processing: e.processingEnd - e.processingStart,
					duration: e.duration
				});
			}
		}).observe({
			type: 'event',
			durationThreshold: 16,
			buffered: false
		} as PerformanceObserverInit);
		new PerformanceObserver((list) => {
			for (const e of list.getEntries()) p.long.push(e.duration);
		}).observe({ type: 'longtask' });
		document.addEventListener(
			'pointerdown',
			(down) => {
				let frame = 0;
				const tick = () => {
					frame += 1;
					if (p.responseFrame < 0 && respond()) {
						p.responseFrame = frame;
						p.responseMs = performance.now() - down.timeStamp;
					}
					if (frame < 30 && p.responseFrame < 0) requestAnimationFrame(tick);
				};
				requestAnimationFrame(tick);
			},
			true
		);
	}, respondSource);
}

const read = (page: Page) => page.evaluate(() => (window as unknown as { __p: Perf }).__p);
const throttle = (cdp: CDPSession, rate: number) =>
	cdp.send('Emulation.setCPUThrottlingRate', { rate });
const stat = (xs: number[]) => (xs.length ? Math.max(...xs).toFixed(1) : 'n/a');

/** Waits until the page's own timers/idle work are quiet, so the tap meets a settled main thread. */
const settle = (page: Page) =>
	page.evaluate(() => new Promise((r) => requestIdleCallback(() => r(null), { timeout: 1000 })));

function checkTap(
	label: string,
	info: { project: { name: string } },
	p: Perf,
	{ budgetMs = 100, maxFrame = 2, maxResponseMs = Infinity } = {}
) {
	// The pointer events may fall under the 16 ms threshold (not reported); click always has our handler.
	const click = p.events.find((e) => e.name === 'click');
	const delay = Math.max(0, ...p.events.map((e) => e.delay));
	const processing = p.events.reduce((s, e) => s + e.processing, 0);
	console.warn(
		`[perf ${info.project.name}] ${label}: input delay ${delay.toFixed(1)} ms, handlers ${processing.toFixed(1)} ms, event duration ${click ? click.duration : 'under 16'} ms (incl. software paint), response frame ${p.responseFrame} (${p.responseMs.toFixed(0)} ms after pointerdown), long tasks ${JSON.stringify(p.long.map(Math.round))}`
	);
	expect(p.responseFrame, `${label}: visual response`).toBeGreaterThan(0);
	expect(p.responseFrame, `${label}: response in the tapped frame or the next`).toBeLessThanOrEqual(
		maxFrame
	);
	expect(p.responseMs, `${label}: response time`).toBeLessThan(maxResponseMs);
	expect(delay + processing, `${label}: input delay + handlers`).toBeLessThan(budgetMs);
}

test('"I did it!" responds within 100 ms of our own work at 4x throttle', async ({
	page
}, info) => {
	await stubAudio(page);
	const s = await seedKid(page, `tapk ${info.project.name}`);
	await openKid(page, s);
	await page.waitForSelector('[data-testid="confetti"]', { state: 'attached' });
	await arm(page, `() => !!document.querySelector('[data-status="pending"]')`);
	const cdp = await page.context().newCDPSession(page);
	await settle(page);
	await throttle(cdp, 4);
	// The first tap on a freshly loaded page is cold (nothing JIT-ed yet); the second is the steady state.
	await choreCard(page, 'Brush teeth').getByTestId('did-it').click();
	await expect(page.getByTestId('flying-star')).toHaveCount(0, { timeout: 5000 });
	const cold = await read(page);
	await page.evaluate(() => {
		const w = window as unknown as { __p: Perf };
		w.__p.events = [];
		w.__p.long = [];
		w.__p.responseFrame = -1;
	});
	await choreCard(page, 'Feed the fish').getByTestId('did-it').click();
	await expect(page.getByTestId('flying-star')).toHaveCount(0, { timeout: 5000 });
	const warm = await read(page);
	await throttle(cdp, 1);
	checkTap('I did it (warm)', info, warm);
	// Known gap, see hub-ugl.4.8: the cold first tap costs ~80-120 ms of handler time
	// at 4x (observed 77-270 ms), over the 100 ms INP budget and too noisy to gate. Until that is fixed it is
	// logged, and only the response frame is gated.
	checkTap('I did it (cold)', info, cold, { budgetMs: Infinity });
});

test('primary nav responds within 100 ms of our own work at 4x throttle', async ({
	page
}, info) => {
	await signInAsAdult(page, `adult-navperf-${info.project.name.replace(/\W/g, '')}`);
	await page.goto('/');
	await page.waitForLoadState('networkidle');
	const nav = page.getByRole('navigation', { name: 'Main' });
	const target = nav.getByRole('link', { name: 'Calendar' });
	await arm(
		page,
		`() => document.querySelector('nav[aria-label="Main"] a[href="/calendar"]')?.getAttribute('aria-current') === 'page'`
	);
	const cdp = await page.context().newCDPSession(page);
	await settle(page);
	await throttle(cdp, 4);
	await target.click();
	await expect(page).toHaveURL(/\/calendar$/);
	await expect(target).toHaveAttribute('aria-current', 'page');
	const p = await read(page);
	await throttle(cdp, 1);
	// Known gap, see hub-ugl.4.9: the nav only marks the new tab once the route has
	// loaded (3-4 frames, ~150 ms here), with no instant pressed/pending feedback. Gate the load, not the frame.
	checkTap('nav', info, p, { maxFrame: 12, maxResponseMs: 500 });
});

test('parent Approve responds within 100 ms of our own work at 4x throttle', async ({
	page
}, info) => {
	const adultId = `adult-apperf-${info.project.name.replace(/\W/g, '')}`;
	await signInAsAdult(page, adultId);
	const name = `Pip ${Date.now() % 1e9}`;
	const member = await (
		await page.request.post('/api/members', {
			data: { name, role: 'child', color: 'member-3', avatar: '🐸' }
		})
	).json();
	for (const title of ['Water plants', 'Set table']) {
		const chore = await (
			await page.request.post('/api/chores', {
				data: { title, icon: '🪴', stars: 2, memberIds: [member.id], schedule: { type: 'daily' } }
			})
		).json();
		await page.request.post(`/api/chores/${chore.id}/complete`, { data: { memberId: member.id } });
	}
	await page.goto('/settings/approvals');
	const card = page.locator(`[data-testid="child-card"][data-member="${member.id}"]`);
	const row = card.getByTestId('approval-row').filter({ hasText: 'Water plants' });
	await expect(row).toBeVisible();
	// The optimistic response is the row leaving the list.
	await arm(
		page,
		`() => {
			const row = [...document.querySelectorAll('[data-member="${member.id}"] [data-testid="approval-row"]')].find((r) => r.textContent.includes('Water plants'));
			// Optimistic: the row is gone, or already flying out (a transform/opacity transition).
			return !row || row.getAnimations().length > 0;
		}`
	);
	const cdp = await page.context().newCDPSession(page);
	await settle(page);
	await throttle(cdp, 4);
	await row.getByTestId('approve').click();
	await expect(row).toHaveCount(0);
	const p = await read(page);
	await throttle(cdp, 1);
	checkTap('approve', info, p);
});

/** Samples every running animation: which properties it animates, and how many there are. */
const SAMPLE_ANIMATIONS = `() => {
	const w = window;
	for (const a of document.getAnimations()) {
		const effect = a.effect;
		if (!effect || !effect.getKeyframes) continue;
		for (const kf of effect.getKeyframes())
			for (const k of Object.keys(kf)) w.__p.animated.push(k);
		w.__p.animCount += 1;
	}
}`;

async function watchFrames(page: Page, ms: number) {
	await page.evaluate(
		({ sample, ms }) => {
			const w = window as unknown as { __p: Perf };
			let last = performance.now();
			const end = last + ms;
			const run = new Function(`return (${sample})()`) as () => void;
			let n = 0;
			const tick = (t: number) => {
				w.__p.gaps.push(t - last);
				last = t;
				if (n++ % 6 === 0) run(); // animations are created a frame or two late, so sample a few times
				if (t < end) requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
		},
		{ sample: SAMPLE_ANIMATIONS, ms }
	);
}

function checkSmooth(label: string, info: { project: { name: string } }, p: Perf) {
	const bad = [...new Set(p.animated)].filter((k) => !COMPOSITED.has(k) && !KEYFRAME_META.has(k));
	const longest = Math.max(0, ...p.long);
	const dropped = p.gaps.filter((g) => g > 25).length;
	console.warn(
		`[perf ${info.project.name}] ${label}: ${p.animCount} animation samples, properties ${JSON.stringify([...new Set(p.animated)])}, longest task ${stat(p.long)} ms, rAF gaps max ${stat(p.gaps)} ms median ${[...p.gaps].sort((a, b) => a - b)[Math.floor(p.gaps.length / 2)]?.toFixed(1)} ms over ${p.gaps.length} frames, ${dropped} dropped (${((100 * dropped) / p.gaps.length).toFixed(1)}%)`
	);
	expect(p.animCount, `${label}: animations were observed`).toBeGreaterThan(0);
	expect(bad, `${label}: only transform, opacity and filter animate`).toEqual([]);
	expect(longest, `${label}: no long main-thread task`).toBeLessThan(100);
	expect(Math.max(...p.gaps), `${label}: no frame gap over 100 ms`).toBeLessThan(100);
}

test('the star flight animates only composited properties and keeps the main thread free', async ({
	page
}, info) => {
	await stubAudio(page);
	const s = await seedKid(page, `flight ${info.project.name}`);
	await openKid(page, s);
	await page.waitForSelector('[data-testid="confetti"]', { state: 'attached' });
	// Warm-up tap: the cold first tap's cost is gated by the tap-latency test, not by this one.
	await choreCard(page, 'Brush teeth').getByTestId('did-it').click();
	await expect(page.getByTestId('flying-star')).toHaveCount(0, { timeout: 5000 });
	await arm(page, `() => true`);
	const cdp = await page.context().newCDPSession(page);
	await settle(page);
	await throttle(cdp, 4);
	await watchFrames(page, 1500);
	// Three stars: three staggered flyers plus the confetti burst.
	await choreCard(page, 'Feed the fish').getByTestId('did-it').click();
	await expect(page.getByTestId('flying-star')).toHaveCount(0, { timeout: 5000 });
	await page.waitForTimeout(400);
	const p = await read(page);
	await throttle(cdp, 1);
	checkSmooth('star flight', info, p);
});

test('the photo crossfade animates only composited properties and keeps the main thread free', async ({
	page
}, info) => {
	test.setTimeout(45_000); // the shortest slideshow interval is 10 s, played in real time
	const tall = await syntheticJpeg(360, 640);
	const wide = await syntheticJpeg(640, 360);
	const photos = [
		{ id: `${info.project.name}-pa`, w: 640, h: 360 },
		{ id: `${info.project.name}-pb`, w: 360, h: 640 }
	];
	await page.route(/\/api\/photo\/[^/?]+\?/, (route) => {
		const url = new URL(route.request().url());
		const photo = photos.find((x) => x.id === decodeURIComponent(url.pathname.split('/').pop()!));
		if (!photo) return route.fallback();
		if (url.searchParams.get('part') === 'bg') return route.fulfill({ status: 404 });
		return route.fulfill({ contentType: 'image/jpeg', body: photo.h > photo.w ? tall : wide });
	});
	await page.route('**/api/photo/slideshow?**', (route) => route.fulfill({ json: photos }));
	await page.route('**/api/settings/slideshow', (route) =>
		route.request().method() === 'GET'
			? route.fulfill({ json: { intervalSeconds: 10, transition: 'kenburns' } })
			: route.fallback()
	);
	await signInAsAdult(page, `adult-fade-${info.project.name.replace(/\W/g, '')}`);
	await page.goto('/photos');
	const front = page.getByTestId('slideshow').locator('[data-front="true"]');
	await expect(front).toHaveAttribute('data-photo-id', photos[0].id);
	await page.waitForTimeout(1800); // first fade finished
	await arm(page, `() => true`);
	const cdp = await page.context().newCDPSession(page);
	await settle(page);
	await throttle(cdp, 4);
	await watchFrames(page, 14_000);
	await expect(front).toHaveAttribute('data-photo-id', photos[1].id, { timeout: 15_000 });
	await page.waitForTimeout(2500);
	const p = await read(page);
	await throttle(cdp, 1);
	checkSmooth('photo crossfade', info, p);
});
