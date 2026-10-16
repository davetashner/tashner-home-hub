/** Ends the adult session. Resolves true when the server confirmed the cookie is cleared. */
export async function requestLock(fetchFn: typeof fetch = fetch): Promise<boolean> {
	try {
		// JSON body, not empty: an empty POST trips SvelteKit's CSRF check.
		const res = await fetchFn('/api/auth/logout', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{}'
		});
		return res.ok;
	} catch {
		return false;
	}
}
