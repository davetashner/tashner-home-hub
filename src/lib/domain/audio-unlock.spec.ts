import { describe, expect, it } from 'vitest';
import { needsResume, unlockOnGesture, UNLOCK_EVENTS } from './audio-unlock.js';

function fakeTarget() {
	const handlers = new Map<string, Set<() => void>>();
	return {
		addEventListener: (t: string, h: () => void) => {
			if (!handlers.has(t)) handlers.set(t, new Set());
			handlers.get(t)!.add(h);
		},
		removeEventListener: (t: string, h: () => void) => handlers.get(t)?.delete(h),
		fire: (t: string) => handlers.get(t)?.forEach((h) => h()),
		count: () => [...handlers.values()].reduce((n, s) => n + s.size, 0)
	};
}

function fakeAudio(state: string, reject = false) {
	const ctx = {
		state,
		resumes: 0,
		resume() {
			ctx.resumes++;
			if (reject) return Promise.reject(new Error('blocked'));
			ctx.state = 'running';
			return Promise.resolve();
		}
	};
	return ctx;
}

describe('needsResume', () => {
	it('resumes suspended and WebKit-interrupted contexts only', () => {
		expect(needsResume('suspended')).toBe(true);
		expect(needsResume('interrupted')).toBe(true);
		expect(needsResume('running')).toBe(false);
		expect(needsResume('closed')).toBe(false);
	});
});

describe('unlockOnGesture', () => {
	it('resumes a suspended context inside the first touchend', () => {
		const target = fakeTarget();
		const ctx = fakeAudio('suspended');
		unlockOnGesture(target, () => ctx);
		target.fire('touchend');
		expect(ctx.resumes).toBe(1);
		expect(ctx.state).toBe('running');
	});

	it('resumes again after iOS interrupts it, and leaves a running context alone', () => {
		const target = fakeTarget();
		const ctx = fakeAudio('running');
		unlockOnGesture(target, () => ctx);
		target.fire('pointerup');
		expect(ctx.resumes).toBe(0);
		ctx.state = 'interrupted';
		target.fire('pointerup');
		expect(ctx.resumes).toBe(1);
	});

	it('asks for the context on each gesture, so the first tap can create it', () => {
		const target = fakeTarget();
		let calls = 0;
		unlockOnGesture(target, () => {
			calls++;
			return null;
		});
		target.fire('click');
		target.fire('click');
		expect(calls).toBe(2);
	});

	it('swallows a rejected resume and unsubscribes cleanly', async () => {
		const target = fakeTarget();
		const ctx = fakeAudio('suspended', true);
		const stop = unlockOnGesture(target, () => ctx);
		expect(target.count()).toBe(UNLOCK_EVENTS.length);
		target.fire('keydown');
		await Promise.resolve();
		stop();
		expect(target.count()).toBe(0);
	});
});
