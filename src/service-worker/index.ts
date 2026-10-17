/// <reference lib="webworker" />
// Offline tolerance (NFR-6, CAL-8, ADR 0001): the wall keeps showing the last calendar, chores
// and photos when the internet or the home server is down.
import { version } from '$app/env';
import { assets, immutable } from '$app/manifest';
import {
	API_TIMEOUT_MS,
	isStorable,
	keysToEvict,
	pickFallback,
	PHOTO_CACHE_MAX,
	routeKind
} from '#lib/domain/offline-cache.js';

const build = immutable.map((e) => e.path as string);
const files = assets.map((e) => e.path as string);
const sw = self as unknown as ServiceWorkerGlobalScope;
const SHELL = `hub-shell-${version}`;
const RUNTIME = 'hub-runtime-v1';
const PHOTOS = 'hub-photos-v1';
const META = 'hub-meta-v1';
const FLAG_URL = '/__hub/sw-enabled';
const DEV = import.meta.env.DEV;

/** Automated browsers (e2e) switch the worker off so they see the real network; see sw-control. */
let enabled = true;
/** True while the last read had to be answered from cache. */
let servedFromCache = false;

const loadFlag = async () => {
	try {
		const hit = await (await caches.open(META)).match(FLAG_URL);
		if (hit) enabled = (await hit.text()) === '1';
	} catch {
		// Keep the default.
	}
};
void loadFlag();

async function setEnabled(value: boolean) {
	enabled = value;
	try {
		await (await caches.open(META)).put(FLAG_URL, new Response(value ? '1' : '0'));
	} catch {
		// Not persisted; the page will tell us again on its next load.
	}
}

async function broadcast() {
	for (const client of await sw.clients.matchAll({ includeUncontrolled: true })) {
		client.postMessage({ type: 'hub-cache-state', servedFromCache });
	}
}

function mark(fromCache: boolean) {
	if (servedFromCache === fromCache) return;
	servedFromCache = fromCache;
	void broadcast();
}

sw.addEventListener('install', (event) => {
	if (DEV) return;
	event.waitUntil(
		caches
			.open(SHELL)
			.then((cache) => cache.addAll([...build, ...files]))
			.then(() => sw.skipWaiting())
	);
});

sw.addEventListener('activate', (event) => {
	if (DEV) return;
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) {
				if (key.startsWith('hub-shell-') && key !== SHELL) await caches.delete(key);
			}
			await sw.clients.claim();
		})()
	);
});

sw.addEventListener('message', (event) => {
	const data = event.data as { type?: string; enabled?: boolean } | undefined;
	if (data?.type === 'hub-sw-enable') event.waitUntil(setEnabled(data.enabled === true));
	if (data?.type === 'hub-cache-state?') void broadcast();
});

/** Resolves with the network response, or rejects on failure or after `ms`. */
function fromNetwork(request: Request, ms: number | null): Promise<Response> {
	const controller = new AbortController();
	const timer = ms === null ? undefined : setTimeout(() => controller.abort(), ms);
	return fetch(request, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

/** Takes its own copy synchronously: the original is about to be streamed to the page. */
async function store(cacheName: string, request: Request, original: Response) {
	if (!isStorable(original)) return;
	const response = original.clone();
	const cache = await caches.open(cacheName);
	await cache.put(request, response);
	if (cacheName === PHOTOS) {
		const keys = await cache.keys();
		for (const stale of keysToEvict(keys, PHOTO_CACHE_MAX)) await cache.delete(stale);
	}
}

/** Tags a saved copy so pages can tell it from a live answer (also survives a worker restart). */
function saved(hit: Response): Response {
	const headers = new Headers(hit.headers);
	headers.set('x-hub-cache', 'saved');
	return new Response(hit.body, { status: hit.status, statusText: hit.statusText, headers });
}

/** After midnight the date/range query no longer matches: fall back to the newest copy of the path. */
async function newestSamePath(cache: Cache, request: Request): Promise<Response | undefined> {
	if (request.mode === 'navigate') return undefined;
	const keys = await cache.keys();
	const key = pickFallback(
		keys.map((k) => k.url),
		request.url
	);
	return key ? cache.match(key) : undefined;
}

/** Network first with a short timeout; the last good response is the fallback. */
async function networkFirst(request: Request, timeoutMs: number | null): Promise<Response> {
	const cache = await caches.open(RUNTIME);
	let failure: unknown;
	try {
		const response = await fromNetwork(request, timeoutMs);
		if (response.status < 500) {
			mark(false);
			void store(RUNTIME, request, response);
			return response;
		}
		failure = response;
	} catch (err) {
		failure = err;
	}
	const hit = (await cache.match(request)) ?? (await newestSamePath(cache, request));
	if (hit) {
		mark(true);
		return saved(hit);
	}
	if (failure instanceof Response) return failure;
	throw failure;
}

async function cacheFirst(request: Request): Promise<Response> {
	const cache = await caches.open(PHOTOS);
	const hit = await cache.match(request);
	if (hit) return hit;
	const response = await fetch(request);
	void store(PHOTOS, request, response);
	return response;
}

async function shellFallback(request: Request): Promise<Response> {
	try {
		return await networkFirst(request, API_TIMEOUT_MS);
	} catch (err) {
		// Offline and this exact screen was never opened: any cached screen still boots the app.
		const any = await caches.match(new URL('/', request.url).href);
		if (any) {
			mark(true);
			return saved(any);
		}
		throw err;
	}
}

sw.addEventListener('fetch', (event) => {
	if (DEV || !enabled) return;
	const { request } = event;
	const url = new URL(request.url);
	if (url.origin !== sw.location.origin) return;

	if (request.method === 'GET' && (build.includes(url.pathname) || files.includes(url.pathname))) {
		event.respondWith(
			caches.open(SHELL).then(async (cache) => (await cache.match(request)) ?? fetch(request))
		);
		return;
	}
	const kind = routeKind(request.method, url, request.mode === 'navigate');
	if (kind === 'page') {
		event.respondWith(
			request.mode === 'navigate' ? shellFallback(request) : networkFirst(request, API_TIMEOUT_MS)
		);
	} else if (kind === 'api') {
		event.respondWith(networkFirst(request, API_TIMEOUT_MS));
	} else if (kind === 'photo') {
		event.respondWith(cacheFirst(request));
	}
});
