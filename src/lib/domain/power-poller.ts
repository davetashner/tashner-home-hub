/**
 * Display power poller (hub-xcr.7): ONE client poll of /api/display/power for the whole wall
 * display, shared by the night clock and the wake guard. A setTimeout chain (never two timers),
 * a single fetch in flight, paused while the page is hidden, and it only reports a change when a
 * field actually differs. Pure: fetch, timers and the clock are injected.
 */
import { parseDisplayMode, type DisplayMode } from './night-clock.js';

export const POWER_POLL_MS = 1000;

export interface PowerSnapshot {
	power: 'on' | 'off';
	mode: DisplayMode;
	until: string | null;
	/** When `power` or `mode` last changed (epoch ms); 0 until the first change. */
	changedAt: number;
}

export interface PowerPollerDeps {
	fetch: (url: string, init: { cache: 'no-store' }) => Promise<Pick<Response, 'ok' | 'json'>>;
	setTimeout: (fn: () => void, ms: number) => unknown;
	clearTimeout: (handle: unknown) => void;
	now: () => number;
	isHidden: () => boolean;
	/** Called with the new snapshot and the names of the fields that differ. */
	onChange: (next: PowerSnapshot, changed: (keyof PowerSnapshot)[]) => void;
	intervalMs?: number;
}

export const INITIAL_POWER: PowerSnapshot = {
	power: 'on',
	mode: 'normal',
	until: null,
	changedAt: 0
};

export function createPowerPoller(deps: PowerPollerDeps) {
	const interval = deps.intervalMs ?? POWER_POLL_MS;
	let snap: PowerSnapshot = { ...INITIAL_POWER };
	let running = false;
	let inFlight = false;
	let timer: unknown = null;
	let epoch = 0;

	function apply(power: 'on' | 'off', mode: DisplayMode, until: string | null) {
		const changed: (keyof PowerSnapshot)[] = [];
		if (power !== snap.power) changed.push('power');
		if (mode !== snap.mode) changed.push('mode');
		if (until !== snap.until) changed.push('until');
		if (!changed.length) return;
		const moved = changed.includes('power') || changed.includes('mode');
		snap = { power, mode, until, changedAt: moved ? deps.now() : snap.changedAt };
		if (moved) changed.push('changedAt');
		deps.onChange(snap, changed);
	}

	function schedule(ms: number) {
		if (!running || timer !== null || deps.isHidden()) return;
		timer = deps.setTimeout(() => {
			timer = null;
			void run();
		}, ms);
	}

	async function run() {
		if (!running || inFlight || deps.isHidden()) return;
		inFlight = true;
		const at = epoch;
		try {
			const res = await deps.fetch('/api/display/power', { cache: 'no-store' });
			if (res.ok) {
				const body = (await res.json()) as Record<string, unknown>;
				if (at === epoch)
					apply(
						body.power === 'off' ? 'off' : 'on',
						parseDisplayMode(body.mode),
						typeof body.until === 'string' ? body.until : null
					);
			}
		} catch {
			// Keep what is known; the next tick corrects it.
		}
		inFlight = false;
		schedule(interval);
	}

	return {
		get snapshot() {
			return snap;
		},
		start() {
			if (running) return;
			running = true;
			schedule(0);
		},
		stop() {
			running = false;
			epoch++;
			if (timer !== null) deps.clearTimeout(timer);
			timer = null;
		},
		/** Call on visibilitychange: pauses while hidden, polls at once when visible again. */
		visibility() {
			if (deps.isHidden()) {
				if (timer !== null) deps.clearTimeout(timer);
				timer = null;
			} else if (timer === null && !inFlight) schedule(0);
		},
		/** An optimistic local change (the night clock tapped awake); drops any answer in flight. */
		setMode(mode: DisplayMode) {
			epoch++;
			apply(mode === 'off' ? 'off' : 'on', mode, snap.until);
		}
	};
}
