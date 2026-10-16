import { expect, test } from '@playwright/test';
import { choreCard, openKid, seedKid } from './kid';

/**
 * ADR 0002 (60 fps at 1440p). Headless Chromium paints in software, so the browser's own tap rendering
 * is slow at 4x throttle with or without celebrations. We hold to the budget what celebrations add:
 * their scripting (User Timing) and a flying star in the very same frame as the pending state.
 */
test('celebration starts in the tapped frame and its scripting fits a frame, at 4x CPU throttle', async ({
	page
}, info) => {
	const s = await seedKid(page, `perf ${info.project.name}`, ['Tidy toys']);
	await openKid(page, s);
	await page.waitForTimeout(1500); // let the confetti chunk preload when idle
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
	await page.evaluate(() => {
		const w = window as unknown as { __perf: Record<string, number | number[]> };
		w.__perf = { long: [], pendingFrame: -1, starFrame: -1, ms: -1, scripting: -1 };
		new PerformanceObserver((list) => {
			for (const e of list.getEntries()) (w.__perf.long as number[]).push(e.duration);
		}).observe({ type: 'longtask' });
		new PerformanceObserver((list) => {
			for (const e of list.getEntries()) {
				if (e.name === 'celebrate') w.__perf.scripting = e.duration;
			}
		}).observe({ type: 'measure' });
		document.addEventListener(
			'click',
			() => {
				const t0 = performance.now();
				let frame = 0;
				const tick = () => {
					frame += 1;
					if (w.__perf.pendingFrame < 0 && document.querySelector('[data-status="pending"]'))
						w.__perf.pendingFrame = frame;
					if (w.__perf.starFrame < 0 && document.querySelector('[data-testid="flying-star"]')) {
						w.__perf.starFrame = frame;
						w.__perf.ms = performance.now() - t0;
					}
					if (frame < 30 && (w.__perf.pendingFrame < 0 || w.__perf.starFrame < 0))
						requestAnimationFrame(tick);
				};
				requestAnimationFrame(tick);
			},
			true
		);
	});
	await choreCard(page, 'Brush teeth').getByTestId('did-it').click();
	await expect(page.getByTestId('flying-star')).toHaveCount(0, { timeout: 5000 });
	const perf = await page.evaluate(
		() => (window as unknown as { __perf: Record<string, number | number[]> }).__perf
	);
	await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
	const long = perf.long as number[];
	console.warn(
		`[perf ${info.project.name}] pending frame ${perf.pendingFrame}, flying-star frame ${perf.starFrame} (${Number(perf.ms).toFixed(1)} ms after tap), celebrate() scripting ${Number(perf.scripting).toFixed(1)} ms, long tasks ${JSON.stringify(long.map((d) => Math.round(d)))}`
	);
	expect(perf.starFrame).toBeGreaterThan(0);
	expect(perf.starFrame).toBeLessThanOrEqual(Number(perf.pendingFrame));
	expect(Number(perf.scripting)).toBeLessThan(50);
});
