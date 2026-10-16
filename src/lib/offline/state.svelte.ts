/** Shared, reactive view of connectivity for the shell. */
export const offline = $state({
	/** The service worker answered a read from its saved copy. */
	cached: false,
	/** The browser's own idea of being online. */
	online: true,
	/** Writes waiting in the queue. */
	queued: 0,
	/** Bumped each time queued writes reach the server, so screens can refresh. */
	synced: 0
});

export const isOffline = () => offline.cached || !offline.online;
