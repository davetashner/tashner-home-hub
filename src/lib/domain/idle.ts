/**
 * Idle timers (UI-6, PHO-4). After `homeMinutes` without a touch the wall returns to the
 * home screen; after `frameMinutes` without a touch (counted from the last touch) the photo
 * frame starts. Any touch while the frame shows leaves it again. 0 turns a timer off.
 */

export interface IdleSettings {
	homeMinutes: number;
	frameMinutes: number;
}

export const DEFAULT_IDLE: IdleSettings = { homeMinutes: 2, frameMinutes: 5 };

/** Window event the settings screen fires (detail: IdleSettings) so new timers apply at once. */
export const IDLE_SETTINGS_EVENT = 'hub-idle-settings';

/** Longest allowed timer: a day. */
export const MAX_IDLE_MINUTES = 24 * 60;

/** True when `v` is a valid timer length in whole minutes (0 = off). */
export function isIdleMinutes(v: unknown): v is number {
	return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_IDLE_MINUTES;
}

const minutes = (v: unknown, fallback: number) => (isIdleMinutes(v) ? v : fallback);

/** Fills missing or invalid values from the defaults. */
export function parseIdleSettings(raw: Record<string, unknown>): IdleSettings {
	return {
		homeMinutes: minutes(raw.homeMinutes, DEFAULT_IDLE.homeMinutes),
		frameMinutes: minutes(raw.frameMinutes, DEFAULT_IDLE.frameMinutes)
	};
}

export type IdlePhase = 'active' | 'home' | 'frame';

export interface IdleDeps {
	setTimeout: (fn: () => void, ms: number) => unknown;
	clearTimeout: (handle: unknown) => void;
	/** Someone is mid-input (a text field has focus): wait one more period before acting. */
	isBusy: () => boolean;
	goHome: () => void;
	startFrame: () => void;
	endFrame: () => void;
}

export interface IdleTimer {
	readonly phase: IdlePhase;
	/** A touch, tap or key press. */
	activity: () => void;
	stop: () => void;
}

const MINUTE = 60_000;

export function createIdleTimer(settings: IdleSettings, deps: IdleDeps): IdleTimer {
	const homeMs = settings.homeMinutes * MINUTE;
	const frameMs = settings.frameMinutes * MINUTE;
	let phase: IdlePhase = 'active';
	let handle: unknown = null;
	let deferred = false;

	function schedule(fn: () => void, ms: number) {
		if (handle !== null) deps.clearTimeout(handle);
		handle = deps.setTimeout(() => {
			handle = null;
			fn();
		}, ms);
	}

	/** Runs `act` unless someone is typing; a busy screen gets one more period, then it acts anyway. */
	function unlessBusy(act: () => void, retryMs: number, retry: () => void) {
		if (!deferred && deps.isBusy()) {
			deferred = true;
			schedule(retry, retryMs);
			return;
		}
		act();
	}

	function fireFrame() {
		unlessBusy(
			() => {
				phase = 'frame';
				deps.startFrame();
			},
			frameMs,
			fireFrame
		);
	}

	function fireHome() {
		unlessBusy(
			() => {
				phase = 'home';
				deps.goHome();
				if (frameMs > 0) schedule(fireFrame, Math.max(0, frameMs - homeMs));
			},
			homeMs,
			fireHome
		);
	}

	function restart() {
		deferred = false;
		if (homeMs > 0 && (frameMs === 0 || homeMs < frameMs)) schedule(fireHome, homeMs);
		else if (frameMs > 0) schedule(fireFrame, frameMs);
	}

	restart();

	return {
		get phase() {
			return phase;
		},
		activity() {
			const wasFrame = phase === 'frame';
			phase = 'active';
			if (wasFrame) deps.endFrame();
			restart();
		},
		stop() {
			if (handle !== null) deps.clearTimeout(handle);
			handle = null;
		}
	};
}
