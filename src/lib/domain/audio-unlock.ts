/** The slice of AudioContext this module needs. WebKit adds an 'interrupted' state. */
export interface ResumableAudio {
	state: string;
	resume(): Promise<void>;
}

type Listenable = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

/** Gestures iOS accepts as a user activation for starting audio. */
export const UNLOCK_EVENTS = ['touchend', 'pointerup', 'click', 'keydown'] as const;

/** Suspended (autoplay policy) and interrupted (call, backgrounding) both need a resume(). */
export function needsResume(state: string): boolean {
	return state !== 'running' && state !== 'closed';
}

/**
 * iOS only lets audio start inside a gesture handler, and takes it back after the app is
 * backgrounded or a call interrupts it. The listeners stay for the page's life: each gesture
 * creates the context if needed and resumes it if it is not running. Returns an unsubscribe.
 */
export function unlockOnGesture(
	target: Listenable,
	getContext: () => ResumableAudio | null
): () => void {
	const onGesture = () => {
		const ctx = getContext();
		if (ctx && needsResume(ctx.state)) void ctx.resume().catch(() => {});
	};
	for (const type of UNLOCK_EVENTS) target.addEventListener(type, onGesture, { passive: true });
	return () => {
		for (const type of UNLOCK_EVENTS) target.removeEventListener(type, onGesture);
	};
}

/** Browsers under automation (Playwright, WebDriver) set navigator.webdriver; the hub stays silent there. */
export function masterGain(webdriver: boolean | undefined): number {
	return webdriver ? 0 : 1;
}
