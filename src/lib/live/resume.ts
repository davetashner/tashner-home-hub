import { createResumeGate, shouldReconnect } from '#lib/domain/live-resume.js';

/**
 * Runs `refresh` when the page returns to the foreground (visible again, or restored from the
 * back/forward cache). If a live connection is passed and has closed, `reconnect` runs first.
 */
export function onAppResume(
	refresh: () => void,
	live?: { readyState: () => number | null; reconnect: () => void }
): () => void {
	const gate = createResumeGate();
	const handle = (signal: Parameters<typeof gate>[0]) => {
		if (!gate(signal, Date.now())) return;
		if (live && shouldReconnect(live.readyState())) live.reconnect();
		refresh();
	};
	const onVisibility = () =>
		handle({ type: 'visibilitychange', visible: document.visibilityState === 'visible' });
	const onPageShow = (e: PageTransitionEvent) =>
		handle({ type: 'pageshow', persisted: e.persisted });
	document.addEventListener('visibilitychange', onVisibility);
	window.addEventListener('pageshow', onPageShow);
	return () => {
		document.removeEventListener('visibilitychange', onVisibility);
		window.removeEventListener('pageshow', onPageShow);
	};
}
