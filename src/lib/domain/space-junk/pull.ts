/**
 * Space Junk (hub-26w.2): the slingshot's pull limits, apart from the physics engine so the
 * renderer's view math does not drag planck into its chunk. `sim.ts` re-exports these.
 */
import type { Point } from './level.js';

/** Longest pull from the pouch's rest position, in metres. */
export const MAX_PULL = 2.5;
/** A shorter pull is a cancelled shot. */
export const MIN_PULL = 0.3;

/** Clamps a pull (pouch position minus anchor) to `MAX_PULL`. */
export function clampPull(pull: Point): Point {
	const len = Math.hypot(pull.x, pull.y);
	if (len <= MAX_PULL) return { x: pull.x, y: pull.y };
	return { x: (pull.x / len) * MAX_PULL, y: (pull.y / len) * MAX_PULL };
}
