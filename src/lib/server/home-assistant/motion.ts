import { recordPowerEvent } from '../display.js';
import {
	initialMotionState,
	nextDelayMs,
	observe,
	stepMotion,
	type MotionObservation
} from '../domain/motion-wake.js';
import { HaError, readEntityState, readMotionWatch, type Deps } from './index.js';

export interface MotionDeps extends Deps {
	wake?: () => void;
	setTimer?: (fn: () => void, ms: number) => { stop: () => void };
}

const defaultTimer = (fn: () => void, ms: number) => {
	const t = setTimeout(fn, ms);
	t.unref();
	return { stop: () => clearTimeout(t) };
};

/**
 * Polls the chosen Home Assistant motion sensor and records the same wake event as the on-wall
 * touch or an HA rest_command (so the sleep schedule treats it identically). One poll at a time:
 * the next is scheduled only after the previous finishes, with backoff while HA is unreachable.
 * With no sensor picked it only re-reads the setting. Returns a handle with `stop`.
 */
export function startMotionWake(deps: MotionDeps = {}): {
	stop: () => void;
	tick: () => Promise<void>;
} {
	const wake = deps.wake ?? (() => void recordPowerEvent('wake'));
	const schedule = deps.setTimer ?? defaultTimer;
	let state = initialMotionState();
	let timer: { stop: () => void } | null = null;
	let stopped = false;

	async function tick(): Promise<void> {
		let key: string | null = null;
		let obs: MotionObservation = 'error';
		try {
			const watch = readMotionWatch(deps);
			key = watch?.key ?? null;
			if (watch) obs = observe(await readEntityState(watch.entityId, deps));
		} catch (e) {
			if (!(e instanceof HaError)) console.error('[motion-wake] poll failed:', e);
		}
		const r = stepMotion(state, key, obs);
		state = r.state;
		if (r.wake) {
			try {
				wake();
			} catch (e) {
				console.error('[motion-wake] recording the wake failed:', e);
			}
		}
		if (!stopped) timer = schedule(() => void tick(), nextDelayMs(state.failures));
	}

	timer = schedule(() => void tick(), nextDelayMs(0));
	return {
		tick,
		stop: () => {
			stopped = true;
			timer?.stop();
		}
	};
}
