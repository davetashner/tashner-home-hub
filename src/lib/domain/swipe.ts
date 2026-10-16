export type SwipeDirection = 'left' | 'right' | 'up' | 'down';

export interface SwipeOptions {
	/** Minimum travel in px along the dominant axis. */
	distance: number;
	/** Minimum speed in px/ms for short flicks to count. */
	velocity: number;
	/** Travel in px below which nothing counts even if fast (filters taps). */
	minDistance: number;
}

export const DEFAULT_SWIPE: SwipeOptions = { distance: 80, velocity: 0.5, minDistance: 24 };

/**
 * Classify a pointer gesture. A swipe is recognised when the dominant axis moved
 * far enough, or moved a little but quickly (a flick). Diagonals resolve to the
 * dominant axis. Returns null for taps and slow short drags.
 */
export function detectSwipe(
	dx: number,
	dy: number,
	elapsedMs: number,
	options: Partial<SwipeOptions> = {}
): SwipeDirection | null {
	const { distance, velocity, minDistance } = { ...DEFAULT_SWIPE, ...options };
	const ax = Math.abs(dx);
	const ay = Math.abs(dy);
	const travel = Math.max(ax, ay);
	if (travel < minDistance) return null;
	const speed = travel / Math.max(elapsedMs, 1);
	if (travel < distance && speed < velocity) return null;
	if (ax >= ay) return dx > 0 ? 'right' : 'left';
	return dy > 0 ? 'down' : 'up';
}
