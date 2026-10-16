export interface ApiResult<T> {
	ok: boolean;
	data: T | null;
	message: string;
}

/** JSON request that never throws: failures come back as a friendly `message`. */
export async function api<T = unknown>(
	url: string,
	method = 'GET',
	body?: unknown
): Promise<ApiResult<T>> {
	try {
		const res = await fetch(url, {
			method,
			headers: { 'content-type': 'application/json' },
			body: body === undefined ? undefined : JSON.stringify(body)
		});
		const data = res.status === 204 ? null : await res.json().catch(() => null);
		if (res.ok) return { ok: true, data: data as T, message: '' };
		const message = (data as { message?: string } | null)?.message;
		return { ok: false, data: null, message: message ?? 'Something went wrong. Please try again.' };
	} catch {
		return { ok: false, data: null, message: 'Could not reach the hub. Check the connection.' };
	}
}
