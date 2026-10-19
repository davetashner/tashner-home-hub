import { describe, expect, it } from 'vitest';
import {
	MOTION_BACKOFF_MAX_MS,
	MOTION_POLL_MS,
	initialMotionState,
	nextDelayMs,
	observe,
	stepMotion,
	type MotionObservation,
	type MotionState
} from './motion-wake.js';

const run = (id: string | null, obs: MotionObservation[], from = initialMotionState()) => {
	let state: MotionState = from;
	const wakes: boolean[] = [];
	for (const o of obs) {
		const r = stepMotion(state, id, o);
		state = r.state;
		wakes.push(r.wake);
	}
	return { state, wakes };
};

describe('stepMotion', () => {
	it('does not wake when the sensor is already on at the first poll', () => {
		expect(run('binary_sensor.hall', ['on']).wakes).toEqual([false]);
	});
	it('wakes only on off -> on', () => {
		expect(run('binary_sensor.hall', ['off', 'on', 'on', 'off', 'on']).wakes).toEqual([
			false,
			true,
			false,
			false,
			true
		]);
	});
	it('does not wake while unreachable, and a later on still needs a prior off', () => {
		const r = run('binary_sensor.hall', ['error', 'error', 'on']);
		expect(r.wakes).toEqual([false, false, false]);
		expect(run('binary_sensor.hall', ['off', 'error', 'on']).wakes).toEqual([false, false, true]);
	});
	it('keeps the last reading through an unavailable poll', () => {
		expect(run('binary_sensor.hall', ['off', 'unavailable', 'on']).wakes[2]).toBe(true);
	});
	it('counts failures and resets them on any answer', () => {
		const e = run('binary_sensor.hall', ['error', 'error']);
		expect(e.state.failures).toBe(2);
		expect(run('binary_sensor.hall', ['off'], e.state).state.failures).toBe(0);
		expect(run('binary_sensor.hall', ['unavailable'], e.state).state.failures).toBe(0);
	});
	it('starts fresh when the sensor changes', () => {
		const a = run('binary_sensor.a', ['off']);
		expect(run('binary_sensor.b', ['on'], a.state).wakes).toEqual([false]);
	});
	it('None resets and never wakes', () => {
		const a = run('binary_sensor.a', ['off']);
		const r = run(null, ['on'], a.state);
		expect(r.wakes).toEqual([false]);
		expect(r.state).toEqual(initialMotionState());
	});
});

describe('observe and nextDelayMs', () => {
	it('maps HA states', () => {
		expect(observe('on')).toBe('on');
		expect(observe('off')).toBe('off');
		expect(observe('unavailable')).toBe('unavailable');
		expect(observe(undefined)).toBe('unavailable');
	});
	it('polls every few seconds, backs off, and caps', () => {
		expect(nextDelayMs(0)).toBe(MOTION_POLL_MS);
		expect(nextDelayMs(1)).toBe(MOTION_POLL_MS * 2);
		expect(nextDelayMs(2)).toBeGreaterThan(nextDelayMs(1));
		expect(nextDelayMs(50)).toBe(MOTION_BACKOFF_MAX_MS);
	});
});
