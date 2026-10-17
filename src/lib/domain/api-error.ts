/** Shown when the hub can't be reached: a restart, a dropped connection, or the proxy giving up. */
export const UNREACHABLE_MESSAGE = "Couldn't reach the hub. Try again in a moment.";

const FALLBACK_MESSAGE = 'Something went wrong.';

/** Statuses a proxy answers while the server behind it is restarting or down. */
const UNREACHABLE_STATUSES = new Set([502, 503, 504]);

export const isUnreachableStatus = (status: number) => UNREACHABLE_STATUSES.has(status);

/**
 * `fetch` that never throws. A network error (offline, connection refused mid-restart) becomes a
 * synthetic 503, so callers handle it like the proxy's own 502/503/504.
 */
export async function safeFetch(
	input: string,
	init?: RequestInit,
	doFetch: typeof fetch = fetch
): Promise<Response> {
	try {
		return await doFetch(input, init);
	} catch {
		return new Response(null, { status: 503 });
	}
}

/**
 * The message to show for a failed response. Unreachable statuses get the retry hint; any other
 * failure keeps the server's own message (validation errors etc.) when it sent one.
 */
export async function errorMessage(res: Response): Promise<string> {
	if (isUnreachableStatus(res.status)) return UNREACHABLE_MESSAGE;
	const err: { message?: unknown } | null = await res.json().catch(() => null);
	return typeof err?.message === 'string' && err.message ? err.message : FALLBACK_MESSAGE;
}
