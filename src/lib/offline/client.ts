import { isOffline, offline } from './state.svelte.js';

/** Wires connectivity events and the service worker; returns a teardown. */
export function startOffline(): () => void {
	offline.online = navigator.onLine;

	// Back online: one cheap read lets the worker see the network again and clear the badge.
	const ping = () =>
		void fetch('/api/approvals/count')
			.then((res) => {
				offline.online = true; // an answer arrived, whatever the browser's flag says
				offline.cached = res.headers.has('x-hub-cache');
			})
			.catch(() => {});
	const onOnline = () => {
		offline.online = true;
		ping();
	};
	// While showing saved copies, keep checking so the badge clears soon after recovery.
	const timer = setInterval(() => isOffline() && ping(), 1_500);
	const onOffline = () => (offline.online = false);
	const onMessage = (event: MessageEvent) => {
		const data = event.data as { type?: string; servedFromCache?: boolean } | undefined;
		if (data?.type === 'hub-cache-state') offline.cached = data.servedFromCache === true;
	};
	window.addEventListener('online', onOnline);
	window.addEventListener('offline', onOffline);

	const container = navigator.serviceWorker;
	container?.addEventListener('message', onMessage);
	// Automated browsers (e2e) run without the worker unless a test opts in with localStorage.
	let optIn = false;
	try {
		optIn = localStorage.getItem('hub.sw') === 'on';
	} catch {
		// Storage blocked: treat as not opted in.
	}
	const enabled = !navigator.webdriver || optIn;
	void container?.ready.then((reg) => {
		reg.active?.postMessage({ type: 'hub-sw-enable', enabled });
		reg.active?.postMessage({ type: 'hub-cache-state?' });
	});

	return () => {
		window.removeEventListener('online', onOnline);
		window.removeEventListener('offline', onOffline);
		container?.removeEventListener('message', onMessage);
		clearInterval(timer);
	};
}
