/** EventSource.CLOSED. iOS kills connections of a backgrounded page and the browser gives up. */
export const EVENT_SOURCE_CLOSED = 2;

export type ResumeSignal =
	{ type: 'visibilitychange'; visible: boolean } | { type: 'pageshow'; persisted: boolean };

/** True for the signals that mean "the page just came back": visible again, or restored from bfcache. */
export function isResume(signal: ResumeSignal): boolean {
	return signal.type === 'visibilitychange' ? signal.visible : signal.persisted;
}

/** A live connection needs reopening when there is none or it has closed (readyState 2). */
export function shouldReconnect(readyState: number | null | undefined): boolean {
	return typeof readyState !== 'number' || readyState === EVENT_SOURCE_CLOSED;
}

/**
 * Decides when a resume signal should trigger a refresh. iOS fires visibilitychange and pageshow
 * together, so signals closer than `minGapMs` to the last refresh collapse into one.
 */
export function createResumeGate(minGapMs = 1000) {
	let last = -Infinity;
	return (signal: ResumeSignal, now: number): boolean => {
		if (!isResume(signal) || now - last < minGapMs) return false;
		last = now;
		return true;
	};
}
