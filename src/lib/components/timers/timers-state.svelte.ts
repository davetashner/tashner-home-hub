import { createLiveChannel } from '#lib/domain/live-events.js';
import {
	addTime,
	pauseTimer,
	resumeTimer,
	startTimer,
	type KitchenTimer
} from '#lib/domain/timers.js';

/**
 * Shared kitchen timer state (TMR-1). The server owns the timers; every screen mirrors them via
 * the `timers` SSE topic plus a slow poll. Taps change the list first and sync after.
 * `now` is the server's clock as best we know it, refreshed by a tick while any timer exists.
 */
export const timerState = $state({ list: [] as KitchenTimer[], now: Date.now(), panel: false });

const POLL_MS = 30_000;
const TICK_MS = 250;
let skew = 0;
let pending = 0;
let holders = 0;
let stop = () => {};

const clock = () => Date.now() + skew;
const json = { 'content-type': 'application/json' };

export async function refreshTimers(): Promise<void> {
	if (pending > 0) return;
	try {
		const res = await fetch('/api/timers');
		if (!res.ok || pending > 0) return;
		const data = (await res.json()) as { now: number; timers: KitchenTimer[] };
		skew = data.now - Date.now();
		timerState.now = clock();
		timerState.list = data.timers;
	} catch {
		// Offline: keep what we have; the next poll or event corrects it.
	}
}

async function send(url: string, init: RequestInit) {
	pending++;
	try {
		const res = await fetch(url, { ...init, headers: json });
		if (!res.ok) throw new Error(String(res.status));
	} catch {
		pending--;
		await refreshTimers();
		return;
	}
	pending--;
	await refreshTimers();
}

export function startKitchenTimer(durationMs: number, label: string | null): void {
	const t = startTimer(crypto.randomUUID(), durationMs, label, clock());
	timerState.list = [...timerState.list, t];
	void send('/api/timers', {
		method: 'POST',
		body: JSON.stringify({ id: t.id, durationMs: t.durationMs, label: t.label })
	});
}

export function changeTimer(id: string, action: 'pause' | 'resume' | 'add', ms = 60_000): void {
	const now = clock();
	const fn = (t: KitchenTimer) =>
		action === 'pause'
			? pauseTimer(t, now)
			: action === 'resume'
				? resumeTimer(t, now)
				: addTime(t, ms, now);
	timerState.list = timerState.list.map((t) => (t.id === id ? fn(t) : t));
	void send(`/api/timers/${id}`, { method: 'PATCH', body: JSON.stringify({ action, ms }) });
}

/** Cancel a running timer or dismiss a finished one. */
export function removeTimer(id: string): void {
	timerState.list = timerState.list.filter((t) => t.id !== id);
	void send(`/api/timers/${id}`, { method: 'DELETE', body: '{}' });
}

/** Starts the shared sync (first holder) and returns the release function. Browser only. */
export function useTimers(): () => void {
	if (holders++ === 0) {
		void refreshTimers();
		const channel = createLiveChannel({
			url: '/api/events',
			topics: ['timers'],
			create: (url) => new EventSource(url),
			onEvent: () => void refreshTimers(),
			onOpen: () => void refreshTimers()
		});
		channel.start();
		const poll = setInterval(() => void refreshTimers(), POLL_MS);
		const tick = setInterval(() => {
			if (timerState.list.length > 0) timerState.now = clock();
		}, TICK_MS);
		const onVisible = () => {
			if (document.visibilityState !== 'visible') return;
			channel.resume();
			timerState.now = clock();
			void refreshTimers();
		};
		document.addEventListener('visibilitychange', onVisible);
		stop = () => {
			channel.stop();
			clearInterval(poll);
			clearInterval(tick);
			document.removeEventListener('visibilitychange', onVisible);
		};
	}
	return () => {
		if (--holders === 0) stop();
	};
}
