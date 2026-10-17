import { createPowerPoller, INITIAL_POWER, type PowerSnapshot } from '#lib/domain/power-poller.js';
import type { DisplayMode } from '#lib/domain/night-clock.js';

/**
 * The wall display's power state (hub-xcr.7): one shared poll of /api/display/power at 1 s, only
 * while a wall-only component holds it (`usePowerState`), paused while the page is hidden.
 * Fields change only when the value differs, so readers do not re-render for nothing.
 */
export const powerState = $state<PowerSnapshot>({ ...INITIAL_POWER });

let holders = 0;
let poller: ReturnType<typeof createPowerPoller> | null = null;

function onVisibility() {
	poller?.visibility();
}

/** Starts the shared poll (first holder) and returns the release function. Browser only. */
export function usePowerState(): () => void {
	if (holders++ === 0) {
		poller = createPowerPoller({
			fetch: (url, init) => fetch(url, init),
			setTimeout: (fn, ms) => window.setTimeout(fn, ms),
			clearTimeout: (h) => window.clearTimeout(h as number),
			now: () => Date.now(),
			isHidden: () => document.hidden,
			onChange: (next, changed) => {
				if (changed.includes('power')) powerState.power = next.power;
				if (changed.includes('mode')) powerState.mode = next.mode;
				if (changed.includes('until')) powerState.until = next.until;
				if (changed.includes('changedAt')) powerState.changedAt = next.changedAt;
			}
		});
		document.addEventListener('visibilitychange', onVisibility);
		poller.start();
	}
	return () => {
		if (--holders > 0) return;
		poller?.stop();
		poller = null;
		document.removeEventListener('visibilitychange', onVisibility);
	};
}

/** Optimistic local change (a touch woke the night clock); the next poll confirms it. */
export function setPowerMode(mode: DisplayMode): void {
	poller?.setMode(mode);
}
