import { describe, expect, it } from 'vitest';
import { createResumeGate, isResume, shouldReconnect } from './live-resume.js';

describe('isResume', () => {
	it('is true when the page becomes visible or is restored from bfcache', () => {
		expect(isResume({ type: 'visibilitychange', visible: true })).toBe(true);
		expect(isResume({ type: 'visibilitychange', visible: false })).toBe(false);
		expect(isResume({ type: 'pageshow', persisted: true })).toBe(true);
		expect(isResume({ type: 'pageshow', persisted: false })).toBe(false);
	});
});

describe('shouldReconnect', () => {
	it('reopens a missing or closed connection, not a connecting or open one', () => {
		expect(shouldReconnect(null)).toBe(true);
		expect(shouldReconnect(undefined)).toBe(true);
		expect(shouldReconnect(2)).toBe(true);
		expect(shouldReconnect(0)).toBe(false);
		expect(shouldReconnect(1)).toBe(false);
	});
});

describe('createResumeGate', () => {
	it('collapses the paired visibilitychange and pageshow into one refresh', () => {
		const gate = createResumeGate(1000);
		expect(gate({ type: 'visibilitychange', visible: true }, 5000)).toBe(true);
		expect(gate({ type: 'pageshow', persisted: true }, 5010)).toBe(false);
		expect(gate({ type: 'visibilitychange', visible: true }, 6500)).toBe(true);
	});

	it('ignores hiding', () => {
		const gate = createResumeGate();
		expect(gate({ type: 'visibilitychange', visible: false }, 1)).toBe(false);
		expect(gate({ type: 'visibilitychange', visible: true }, 2)).toBe(true);
	});
});
