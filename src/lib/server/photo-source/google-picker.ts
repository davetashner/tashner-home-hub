import { GoogleError, REAUTH_MESSAGE } from '../calendar/google.js';
import type { PickedItem } from '../domain/photos-import.js';

export const PICKER_SCOPE = 'https://www.googleapis.com/auth/photospicker.mediaitems.readonly';
const TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;
export const MAX_PAGES = 50;

/** Overridable so tests can point elsewhere. */
export const pickerEndpoint = { api: 'https://photospicker.googleapis.com/v1' };

export interface PickerSession {
	id: string;
	pickerUri: string;
	mediaItemsSet?: boolean;
	pollingConfig?: { pollInterval?: string; timeoutIn?: string };
}

async function call(url: string, init: RequestInit, timeout = TIMEOUT_MS): Promise<Response> {
	try {
		return await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
	} catch {
		throw new GoogleError('Could not reach Google');
	}
}

function fail(res: Response): never {
	void res.body?.cancel();
	if (res.status === 401) throw new GoogleError(REAUTH_MESSAGE, true);
	if (res.status === 403)
		throw new GoogleError(
			'Google denied access. Enable the Photos Picker API in Google Cloud Console and reconnect'
		);
	throw new GoogleError(`Google answered ${res.status}`);
}

const auth = (token: string) => ({ authorization: `Bearer ${token}`, accept: 'application/json' });

export async function createSession(token: string): Promise<PickerSession> {
	const res = await call(`${pickerEndpoint.api}/sessions`, {
		method: 'POST',
		headers: { ...auth(token), 'content-type': 'application/json' },
		body: '{}'
	});
	if (!res.ok) fail(res);
	return (await res.json()) as PickerSession;
}

export async function getSession(token: string, id: string): Promise<PickerSession> {
	const res = await call(`${pickerEndpoint.api}/sessions/${encodeURIComponent(id)}`, {
		headers: auth(token)
	});
	if (!res.ok) fail(res);
	return (await res.json()) as PickerSession;
}

export async function listPicked(token: string, sessionId: string): Promise<PickedItem[]> {
	const out: PickedItem[] = [];
	let pageToken: string | undefined;
	for (let page = 0; page < MAX_PAGES; page++) {
		const q = new URLSearchParams({ sessionId, pageSize: '100' });
		if (pageToken) q.set('pageToken', pageToken);
		const res = await call(`${pickerEndpoint.api}/mediaItems?${q}`, { headers: auth(token) });
		if (!res.ok) fail(res);
		const body = (await res.json()) as { mediaItems?: PickedItem[]; nextPageToken?: string };
		out.push(...(body.mediaItems ?? []));
		pageToken = body.nextPageToken;
		if (!pageToken) break;
	}
	return out;
}

/** Best effort: a leftover session expires on Google's side anyway. */
export async function deleteSession(token: string, id: string): Promise<void> {
	try {
		const res = await call(`${pickerEndpoint.api}/sessions/${encodeURIComponent(id)}`, {
			method: 'DELETE',
			headers: auth(token)
		});
		void res.body?.cancel();
	} catch {
		// ignored
	}
}

/** Original-size bytes of one image (`=d` asks for the download rendition). */
export async function downloadBytes(token: string, baseUrl: string): Promise<Buffer> {
	const res = await call(
		`${baseUrl}=d`,
		{ headers: { authorization: `Bearer ${token}` } },
		DOWNLOAD_TIMEOUT_MS
	);
	if (!res.ok) fail(res);
	return Buffer.from(await res.arrayBuffer());
}
