/**
 * Motion-sensor wake (hub-bue): pure state machine for polling a Home Assistant binary_sensor and
 * waking the wall on an off -> on transition. The HTTP and the timer live in
 * `server/home-assistant/motion.ts`.
 */

export const MOTION_POLL_MS = 5_000;
export const MOTION_BACKOFF_MAX_MS = 60_000;

/** What one poll saw. `unavailable` is HA answering "unavailable"/"unknown"; `error` is HA unreachable. */
export type MotionObservation = 'on' | 'off' | 'unavailable' | 'error';

export interface MotionState {
	/** The sensor being tracked; a different one starts fresh. */
	entityId: string | null;
	/** The last known reading; null until the first poll answers (so a sensor already on never wakes). */
	last: boolean | null;
	/** Consecutive unreachable polls, for backoff. */
	failures: number;
}

export const initialMotionState = (): MotionState => ({
	entityId: null,
	last: null,
	failures: 0
});

/** Maps an HA state string to an observation. */
export function observe(state: unknown): MotionObservation {
	if (state === 'on') return 'on';
	if (state === 'off') return 'off';
	return 'unavailable';
}

/**
 * Folds one poll into the state. `wake` is true only on an off -> on transition of the same sensor.
 * `entityId` null (feature off) resets everything.
 */
export function stepMotion(
	prev: MotionState,
	entityId: string | null,
	obs: MotionObservation
): { state: MotionState; wake: boolean } {
	if (!entityId) return { state: initialMotionState(), wake: false };
	const base = prev.entityId === entityId ? prev : { entityId, last: null, failures: 0 };
	if (obs === 'error') return { state: { ...base, failures: base.failures + 1 }, wake: false };
	if (obs === 'unavailable') return { state: { ...base, failures: 0 }, wake: false };
	const on = obs === 'on';
	return { state: { entityId, last: on, failures: 0 }, wake: on && base.last === false };
}

/** Time until the next poll: the normal interval, doubling per consecutive failure up to a cap. */
export function nextDelayMs(failures: number): number {
	if (failures <= 0) return MOTION_POLL_MS;
	return Math.min(MOTION_POLL_MS * 2 ** failures, MOTION_BACKOFF_MAX_MS);
}
