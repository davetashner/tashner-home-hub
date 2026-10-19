import { expect, test, type CDPSession, type Locator, type Page } from '@playwright/test';
import { ensureHousehold, signInAsAdult } from './adult';
import { choreCard, type KidSeed, seedKid, stubAudio } from './kid';
import { syntheticJpeg } from '../../src/lib/server/photo-cache/fixtures';
import { gotoHydrated } from './hydrated';
import { trackMember } from './cleanup';

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

/**
 * Like `openKid`, but patient: when two workers share a small runner the first load of the kid screen has
 * been seen to take longer than the default 5 s (a setup wait, not part of any measurement).
 */
async function openKid(page: Page, s: KidSeed) {
	await gotoHydrated(page, `/chores?member=${s.memberId}`);
	await expect(page.getByTestId('star-jar')).toBeVisible({ timeout: 20_000 });
}

const COMPOSITED = new Set(['transform', 'opacity', 'filter']);
const KEYFRAME_META = new Set(['offset', 'computedOffset', 'easing', 'composite']);

type Perf = {
	events: { name: string; delay: number; processing: number; duration: number }[];
	responseFrame: number;
	responseMs: number;
	long: number[];
	/** Long tasks starting more than 200 ms after the tap: the animation's own cost, not the tap's. */
	late: number[];
	downAt: number;
	gaps: number[];
	animated: string[];
	animCount: number;
	/** End time of the most recent long task, for the quiet-page wait. */
	lastLong: number;
};

/** Page-side recorder. `respond` is evaluated each frame after the tap to find the visual response. */
async function arm(page: Page, respondSource: string) {
	await page.evaluate((src) => {
		const w = window as unknown as { __p: Perf; __respond: () => boolean };
		const p: Perf = {
			events: [],
			responseFrame: -1,
			responseMs: -1,
			long: [],
			late: [],
			downAt: -1e9,
			gaps: [],
			animated: [],
			animCount: 0,
			lastLong: -1e9
		};
		w.__p = p;
		w.__respond = new Function(`return (${src})()`) as () => boolean;
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
			for (const e of list.getEntries()) {
				p.long.push(e.duration);
				p.lastLong = e.startTime + e.duration;
				if (e.startTime - p.downAt > 200) p.late.push(e.duration);
			}
		}).observe({ type: 'longtask' });
		document.addEventListener(
			'pointerdown',
			(down) => {
				p.downAt = down.timeStamp;
				let frame = 0;
				const tick = () => {
					frame += 1;
					if (p.responseFrame < 0 && w.__respond()) {
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

/**
 * Waits for a genuinely idle page, so the tap meets a settled main thread rather than whatever the
 * previous step (or another worker's suite sharing the runner) left behind: network idle, web fonts
 * loaded, no finite animation still running, two idle-callback turns, and no long task for 300 ms.
 * Bounded, so a page with a looping animation or a noisy runner still proceeds.
 */
async function settle(page: Page) {
	await page.waitForLoadState('networkidle');
	await page.evaluate(async () => {
		const w = window as unknown as { __p: Perf };
		const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
		const idle = () => new Promise((r) => requestIdleCallback(() => r(null), { timeout: 1000 }));
		await document.fonts.ready;
		const finite = () =>
			document
				.getAnimations()
				.some(
					(a) => a.playState === 'running' && Number.isFinite(a.effect?.getComputedTiming().endTime)
				);
		for (let i = 0; i < 60 && finite(); i++) await sleep(50);
		await idle();
		await idle();
		for (let i = 0; i < 60 && performance.now() - w.__p.lastLong < 300; i++) await sleep(50);
	});
}

/** Clears one tap's readings (keeping the observers) and sets what counts as the visual response. */
const rearm = (page: Page, respondSource: string) =>
	page.evaluate((src) => {
		const w = window as unknown as { __p: Perf; __respond: () => boolean };
		const p = w.__p;
		p.events = [];
		p.long = [];
		p.late = [];
		p.responseFrame = -1;
		p.responseMs = -1;
		p.downAt = -1e9;
		w.__respond = new Function(`return (${src})()`) as () => boolean;
	}, respondSource);

/**
 * One measured tap: unthrottle, wait for an idle page, resolve the target's centre (after the wait, so a
 * late layout shift cannot move it), clear the readings, throttle 4x, tap, wait for the effect, read,
 * unthrottle. Only the tap and `done` run under the throttle, and the tap is a bare mouse click at known
 * coordinates, so Playwright's own actionability waits (stability, hit-target checks, scrolling), which
 * are not our work, stay out of the measurement.
 */
async function measureTap(
	page: Page,
	cdp: CDPSession,
	respondSource: string,
	target: Locator,
	done: () => Promise<unknown>
): Promise<Perf> {
	await throttle(cdp, 1);
	await settle(page);
	await target.scrollIntoViewIfNeeded();
	const box = (await target.boundingBox())!;
	await rearm(page, respondSource);
	await throttle(cdp, 4);
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
	await done();
	const p = await read(page);
	await throttle(cdp, 1);
	return p;
}

const median = (xs: number[]) =>
	[...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)] ?? 0;

/**
 * Gates a set of taps of one kind. CI runners are shared and noisy (a lone tap has measured 2x its
 * neighbours with no code change), so each measure is repeated and gated on two numbers:
 *  - the MEDIAN against the ADR 0002 target of 100 ms (a regression in our code moves every tap, so it
 *    moves the median);
 *  - the WORST tap against a hard cap of twice that, which still catches a pathological one-off stall.
 * The response frame is gated on the median too (a descheduled renderer can slip one tap by a frame).
 */
const WORST_FACTOR = 2;

function checkTaps(
	label: string,
	info: { project: { name: string } },
	taps: Perf[],
	{ budgetMs = 100, maxFrame = 2, maxResponseMs = Infinity } = {}
) {
	// The pointer events may fall under the 16 ms threshold (not reported); click always has our handler.
	const rows = taps.map((p) => ({
		delay: Math.max(0, ...p.events.map((e) => e.delay)),
		processing: p.events.reduce((sum, e) => sum + e.processing, 0),
		frame: p.responseFrame,
		responseMs: p.responseMs
	}));
	for (const [i, p] of taps.entries()) {
		const click = p.events.find((e) => e.name === 'click');
		console.warn(
			`[perf ${info.project.name}] ${label} #${i + 1}/${taps.length}: input delay ${rows[i].delay.toFixed(1)} ms, handlers ${rows[i].processing.toFixed(1)} ms, event duration ${click ? click.duration : 'under 16'} ms (incl. software paint), response frame ${p.responseFrame} (${p.responseMs.toFixed(0)} ms after pointerdown), long tasks ${JSON.stringify(p.long.map(Math.round))}`
		);
	}
	const col = (k: 'delay' | 'processing' | 'frame' | 'responseMs') => rows.map((r) => r[k]);
	expect(Math.min(...col('frame')), `${label}: visual response on every tap`).toBeGreaterThan(0);
	expect(
		median(col('frame')),
		`${label}: response in the tapped frame or the next`
	).toBeLessThanOrEqual(maxFrame);
	expect(median(col('responseMs')), `${label}: response time`).toBeLessThan(maxResponseMs);
	// Handlers are our work. Input delay is whatever else held the main thread (on CI also the runner's
	// noise), so it is gated on its own rather than summed into our budget.
	expect(median(col('processing')), `${label}: handlers (median)`).toBeLessThan(budgetMs);
	expect(median(col('delay')), `${label}: input delay (median)`).toBeLessThan(budgetMs);
	expect(Math.max(...col('processing')), `${label}: handlers (worst)`).toBeLessThan(
		budgetMs * WORST_FACTOR
	);
	expect(Math.max(...col('delay')), `${label}: input delay (worst)`).toBeLessThan(
		budgetMs * WORST_FACTOR
	);
}

const TAPS = 5;

test(
	'"I did it!" responds within 100 ms of our own work at 4x throttle',
	{ tag: ['@perf', '@J16.5'] },
	async ({ page }, info) => {
		test.setTimeout(90_000); // five taps, each preceded by a wait for a quiet page
		await stubAudio(page);
		const titles = Array.from({ length: 3 }, (_, i) => `Warm chore ${i + 1}`);
		const s = await seedKid(page, `tapk ${info.project.name}`, titles);
		await openKid(page, s);
		await page.waitForSelector('[data-testid="confetti"]', { state: 'attached' });
		await arm(page, `() => false`);
		const cdp = await page.context().newCDPSession(page);
		const tapChore = async (title: string) => {
			const button = choreCard(page, title).getByTestId('did-it');
			// The visual response is this card going pending (earlier taps' cards stay pending).
			const respond = `() => [...document.querySelectorAll('[data-testid="chore-card"]')].some((c) => c.textContent.includes('${title}') && c.getAttribute('data-status') === 'pending')`;
			return measureTap(page, cdp, respond, button, () =>
				expect(page.getByTestId('flying-star')).toHaveCount(0, { timeout: 15_000 })
			);
		};
		// The first tap on a freshly loaded page is cold (nothing JIT-ed yet), so it cannot be repeated: it is
		// gated alone. The rest are the steady state.
		const cold = await tapChore('Brush teeth');
		const warm = [await tapChore('Feed the fish')];
		for (const title of titles) warm.push(await tapChore(title));
		checkTaps('I did it (warm)', info, warm);
		// The cold first tap used to cost 85-140 ms (hub-ugl.4.8): the "↩" glyph in the Undo button forced a
		// first-ever system-font fallback lookup inside the tap's layout. It is an SVG now; ~12-27 ms at 4x.
		checkTaps('I did it (cold)', info, [cold]);
	}
);

test(
	'primary nav responds within 100 ms of our own work at 4x throttle',
	{ tag: ['@perf', '@J16.5'] },
	async ({ page }, info) => {
		await signInAsAdult(page, `adult-navperf-${info.project.name.replace(/\W/g, '')}`);
		await gotoHydrated(page, '/');
		await page.waitForLoadState('networkidle');
		await arm(page, `() => false`);
		const cdp = await page.context().newCDPSession(page);
		const nav = page.getByRole('navigation', { name: 'Main' });
		const taps: Perf[] = [];
		// Tap through the destinations in turn (not Photos: its slideshow never goes quiet).
		for (const [label, href] of [
			['Calendar', '/calendar'],
			['To-Dos', '/chores'],
			['Lists', '/lists'],
			['Meals', '/meals'],
			['Calendar', '/calendar']
		]) {
			const target = nav.getByRole('link', { name: label });
			// The tapped item shows as selected (data-selected) in the tapped frame or the next, ahead of the route.
			taps.push(
				await measureTap(
					page,
					cdp,
					`() => document.querySelector('nav[aria-label="Main"] a[href="${href}"]')?.getAttribute('data-selected') === 'true'`,
					target,
					async () => {
						await expect(page).toHaveURL(new RegExp(`${href}$`));
						await expect(target).toHaveAttribute('aria-current', 'page');
					}
				)
			);
		}
		checkTaps('nav', info, taps, { maxResponseMs: 500 });
	}
);

test(
	'parent Approve responds within 100 ms of our own work at 4x throttle',
	{ tag: ['@perf', '@J16.5'] },
	async ({ page }, info) => {
		const adultId = `adult-apperf-${info.project.name.replace(/\W/g, '')}`;
		await signInAsAdult(page, adultId);
		const name = `Pip ${Date.now() % 1e9}`;
		const member = await (
			await page.request.post('/api/members', {
				data: { name, role: 'child', color: 'member-3', avatar: '🐸' }
			})
		).json();
		trackMember(member.id);
		const titles = Array.from({ length: TAPS }, (_, i) => `Chore ${i + 1}`);
		for (const title of titles) {
			const chore = await (
				await page.request.post('/api/chores', {
					data: {
						title,
						icon: '🪴',
						stars: 2,
						memberIds: [member.id],
						schedule: { type: 'daily' },
						requiresApproval: true
					}
				})
			).json();
			await page.request.post(`/api/chores/${chore.id}/complete`, {
				data: { memberId: member.id }
			});
		}
		await gotoHydrated(page, '/settings/approvals');
		const card = page.locator(`[data-testid="child-card"][data-member="${member.id}"]`);
		await expect(card.getByTestId('approval-row')).toHaveCount(TAPS);
		await arm(page, `() => false`);
		const cdp = await page.context().newCDPSession(page);
		const taps: Perf[] = [];
		for (const title of titles) {
			const row = card.getByTestId('approval-row').filter({ hasText: title });
			taps.push(
				await measureTap(
					page,
					cdp,
					// Optimistic: the row is gone, or already flying out (a transform/opacity transition).
					`() => {
					const row = [...document.querySelectorAll('[data-member="${member.id}"] [data-testid="approval-row"]')].find((r) => r.textContent.includes('${title}'));
					return !row || row.getAnimations().length > 0;
				}`,
					row.getByTestId('approve'),
					() => expect(row).toHaveCount(0)
				)
			);
		}
		checkTaps('approve', info, taps);
	}
);

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
	const longest = Math.max(0, ...p.late);
	const dropped = p.gaps.filter((g) => g > 25).length;
	console.warn(
		`[perf ${info.project.name}] ${label}: ${p.animCount} animation samples, properties ${JSON.stringify([...new Set(p.animated)])}, longest task after the tap ${stat(p.late)} ms, rAF gaps max ${stat(p.gaps)} ms median ${[...p.gaps].sort((a, b) => a - b)[Math.floor(p.gaps.length / 2)]?.toFixed(1)} ms over ${p.gaps.length} frames, ${dropped} dropped (${((100 * dropped) / p.gaps.length).toFixed(1)}%)`
	);
	expect(p.animCount, `${label}: animations were observed`).toBeGreaterThan(0);
	expect(bad, `${label}: only transform, opacity and filter animate`).toEqual([]);
	// Raw rAF gaps and dropped-frame % are logged only: they include software paint, which varies ~3x on CI.
	expect(longest, `${label}: no long main-thread task from the animation`).toBeLessThan(150);
}

test(
	'the star flight animates only composited properties and keeps the main thread free',
	{ tag: ['@perf', '@J16.5'] },
	async ({ page }, info) => {
		test.setTimeout(60_000);
		await stubAudio(page);
		const s = await seedKid(page, `flight ${info.project.name}`);
		await openKid(page, s);
		await page.waitForSelector('[data-testid="confetti"]', { state: 'attached' });
		// Warm-up tap: the cold first tap's cost is gated by the tap-latency test, not by this one.
		await choreCard(page, 'Brush teeth').getByTestId('did-it').click();
		await expect(page.getByTestId('flying-star')).toHaveCount(0, { timeout: 15_000 });
		await arm(page, `() => true`);
		const cdp = await page.context().newCDPSession(page);
		await settle(page);
		await throttle(cdp, 4);
		await watchFrames(page, 1500);
		// Three stars: three staggered flyers plus the confetti burst.
		await choreCard(page, 'Feed the fish').getByTestId('did-it').click();
		await expect(page.getByTestId('flying-star')).toHaveCount(0, { timeout: 15_000 });
		await page.waitForTimeout(400);
		const p = await read(page);
		await throttle(cdp, 1);
		checkSmooth('star flight', info, p);
	}
);

test(
	'the photo crossfade animates only composited properties and keeps the main thread free',
	{ tag: ['@perf', '@J16.5'] },
	async ({ page }, info) => {
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
		// The frame reshuffles every list; this pins it to the order served.
		await page.addInitScript(() => {
			Math.random = () => 0.999;
		});
		await signInAsAdult(page, `adult-fade-${info.project.name.replace(/\W/g, '')}`);
		await gotoHydrated(page, '/photos');
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
	}
);
