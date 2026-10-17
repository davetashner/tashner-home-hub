import { describe, expect, it } from 'vitest';
import { createWakeGuard, WAKE_GUARD_MS } from './wake-guard';

describe('wake guard', () => {
	it('does not block before anything is known or while the display stays normal', () => {
		const g = createWakeGuard();
		expect(g.swallows(0)).toBe(false);
		g.observe('normal', 0);
		g.observe('normal', 1000);
		expect(g.swallows(1000)).toBe(false);
	});

	it('swallows everything while the display is off', () => {
		const g = createWakeGuard();
		g.observe('off', 0);
		expect(g.swallows(60_000)).toBe(true);
	});

	it('swallows for the window after off -> normal, then lets taps through', () => {
		const g = createWakeGuard();
		g.observe('off', 0);
		g.observe('normal', 1000);
		expect(g.swallows(1000)).toBe(true);
		expect(g.swallows(1000 + WAKE_GUARD_MS - 1)).toBe(true);
		expect(g.swallows(1000 + WAKE_GUARD_MS)).toBe(false);
	});

	it('treats night clock -> normal like off -> normal, but never blocks the night clock itself', () => {
		const g = createWakeGuard();
		g.observe('night-clock', 0);
		expect(g.swallows(10)).toBe(false);
		g.observe('normal', 20);
		expect(g.swallows(30)).toBe(true);
		expect(g.swallows(20 + WAKE_GUARD_MS)).toBe(false);
	});

	it('does not arm on the first observation, or for normal -> night-clock / off', () => {
		const g = createWakeGuard();
		g.observe('normal', 0);
		expect(g.swallows(1)).toBe(false);
		g.observe('night-clock', 2);
		expect(g.swallows(3)).toBe(false);
	});

	it('swallows for the window after the page becomes visible', () => {
		const g = createWakeGuard(500);
		g.observe('normal', 0);
		g.resume(10_000);
		expect(g.swallows(10_499)).toBe(true);
		expect(g.swallows(10_500)).toBe(false);
	});
});
