import { errorMessage, safeFetch } from '#lib/domain/api-error.js';

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
	const res = await safeFetch(url, {
		method,
		headers: { 'content-type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	if (!res.ok) return { ok: false, data: null, message: await errorMessage(res) };
	const data = res.status === 204 ? null : await res.json().catch(() => null);
	return { ok: true, data: data as T, message: '' };
}
