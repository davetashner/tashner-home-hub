/** Shared, reactive view of connectivity for the shell. */
export const offline = $state({
	/** The service worker answered a read from its saved copy. */
	cached: false,
	/** The browser's own idea of being online. */
	online: true
});

export const isOffline = () => offline.cached || !offline.online;
