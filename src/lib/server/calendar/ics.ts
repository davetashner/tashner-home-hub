import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDb, type Db } from '../db/index.js';
import { settings } from '../db/schema.js';
import { parseIcs, IcsParseError } from '../domain/calendar/ics-parse.js';
import { decryptSecret, encryptSecret, type Keyring } from '../domain/secrets.js';
import { getKeyring } from '../keys.js';
import {
	providerRegistry,
	type CalendarProvider,
	type CalendarSource,
	type RemoteCalendar,
	type RemoteEvent
} from './provider.js';

export const FETCH_TIMEOUT_MS = 15_000;
export const MAX_BYTES = 10 * 1024 * 1024;
export const MAX_REDIRECTS = 5;

/** A failure with a message that is safe to show an adult (never contains the feed URL). */
export class IcsError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'IcsError';
	}
}

export interface FetchOptions {
	timeoutMs?: number;
	maxBytes?: number;
	maxRedirects?: number;
	etag?: string | undefined;
	lastModified?: string | undefined;
}

export interface FetchResult {
	/** Null when the server answered 304 Not Modified. */
	body: string | null;
	etag?: string | undefined;
	lastModified?: string | undefined;
}

/** `webcal://` and `webcals://` are `https://` in disguise. */
export function normalizeUrl(raw: string): URL {
	let u: URL;
	try {
		u = new URL(raw.trim().replace(/^webcals?:\/\//i, 'https://'));
	} catch {
		throw new IcsError('That does not look like a calendar URL');
	}
	if (u.protocol !== 'https:' && u.protocol !== 'http:') {
		throw new IcsError('Calendar URLs must start with https://, http:// or webcal://');
	}
	return u;
}

/** Host only: private feeds embed tokens in the path or query. */
export function maskedHost(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return '';
	}
}

export const calendarIdFor = (url: string): string =>
	createHash('sha256').update(url).digest('hex').slice(0, 16);

async function readCapped(res: Response, max: number): Promise<string> {
	const declared = Number(res.headers.get('content-length'));
	if (declared > max) throw new IcsError('The calendar feed is too large (over 10 MB)');
	const chunks: Uint8Array[] = [];
	let total = 0;
	if (res.body) {
		for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
			total += chunk.byteLength;
			if (total > max) throw new IcsError('The calendar feed is too large (over 10 MB)');
			chunks.push(chunk);
		}
	}
	return Buffer.concat(chunks).toString('utf8');
}

export async function fetchIcs(rawUrl: string, opts: FetchOptions = {}): Promise<FetchResult> {
	const timeout = opts.timeoutMs ?? FETCH_TIMEOUT_MS;
	const maxRedirects = opts.maxRedirects ?? MAX_REDIRECTS;
	const headers: Record<string, string> = {
		accept: 'text/calendar, text/plain;q=0.8, */*;q=0.5',
		'user-agent': 'TashnerHomeHub/1.0'
	};
	if (opts.etag) headers['if-none-match'] = opts.etag;
	if (opts.lastModified) headers['if-modified-since'] = opts.lastModified;

	let url = normalizeUrl(rawUrl);
	const signal = AbortSignal.timeout(timeout);
	try {
		for (let hop = 0; ; hop++) {
			const res = await fetch(url, { headers, redirect: 'manual', signal });
			if (res.status >= 300 && res.status < 400 && res.headers.has('location')) {
				void res.body?.cancel();
				if (hop >= maxRedirects) throw new IcsError('The calendar URL redirects too many times');
				url = normalizeUrl(new URL(res.headers.get('location')!, url).href);
				continue;
			}
			if (res.status === 304)
				return { body: null, etag: opts.etag, lastModified: opts.lastModified };
			if (!res.ok) {
				void res.body?.cancel();
				throw new IcsError(`The calendar server answered ${res.status}`);
			}
			const body = await readCapped(res, opts.maxBytes ?? MAX_BYTES);
			return {
				body,
				etag: res.headers.get('etag') ?? undefined,
				lastModified: res.headers.get('last-modified') ?? undefined
			};
		}
	} catch (e) {
		if (e instanceof IcsError) throw e;
		if (signal.aborted) throw new IcsError('The calendar server took too long to respond');
		throw new IcsError('Could not reach the calendar server');
	}
}

const householdZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

interface CacheEntry {
	etag?: string | undefined;
	lastModified?: string | undefined;
	name?: string | undefined;
	events: RemoteEvent[];
}

const cacheKey = (sourceId: string) => `calendar.ics.cache.${sourceId}`;

function readCache(db: Db, sourceId: string): CacheEntry | null {
	const row = db
		.select()
		.from(settings)
		.where(eq(settings.key, cacheKey(sourceId)))
		.get();
	return row ? (JSON.parse(row.value) as CacheEntry) : null;
}

function writeCache(db: Db, sourceId: string, entry: CacheEntry): void {
	const value = JSON.stringify(entry);
	db.insert(settings)
		.values({ key: cacheKey(sourceId), value })
		.onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: Date.now() } })
		.run();
}

export function clearIcsCache(db: Db, sourceId: string): void {
	db.delete(settings)
		.where(eq(settings.key, cacheKey(sourceId)))
		.run();
}

const aad = (sourceId: string) => `calendar_source:${sourceId}`;

export function sealUrl(keyring: Keyring, sourceId: string, url: string): string {
	return encryptSecret(keyring, JSON.stringify({ url }), aad(sourceId));
}

export function openUrl(
	keyring: Keyring,
	source: Pick<CalendarSource, 'id' | 'credentials'>
): string {
	if (!source.credentials) throw new IcsError('This calendar has no stored URL');
	const { url } = JSON.parse(decryptSecret(keyring, source.credentials, aad(source.id))) as {
		url: string;
	};
	return url;
}

/** Fetches and parses a feed, using (and refreshing) the conditional-GET cache for `sourceId` if given. */
async function load(
	url: string,
	cache: CacheEntry | null,
	opts: FetchOptions
): Promise<{ entry: CacheEntry; fresh: boolean }> {
	const res = await fetchIcs(url, {
		...opts,
		etag: cache?.etag,
		lastModified: cache?.lastModified
	});
	if (res.body === null && cache) return { entry: cache, fresh: false };
	if (res.body === null) throw new IcsError('The calendar server returned no content');
	let parsed;
	try {
		parsed = parseIcs(res.body, householdZone());
	} catch (e) {
		if (e instanceof IcsParseError) throw new IcsError(e.message);
		throw e;
	}
	return {
		entry: {
			etag: res.etag,
			lastModified: res.lastModified,
			name: parsed.name,
			events: parsed.events
		},
		fresh: true
	};
}

/** Validates a URL by fetching it once. Throws IcsError with a friendly reason. */
export async function probeIcs(
	rawUrl: string,
	opts: FetchOptions = {}
): Promise<{ externalId: string; name?: string | undefined; events: RemoteEvent[] }> {
	const url = normalizeUrl(rawUrl).href;
	const { entry } = await load(url, null, opts);
	return { externalId: calendarIdFor(url), name: entry.name, events: entry.events };
}

export function createIcsProvider(
	source: CalendarSource,
	deps: { db?: Db; keyring?: Keyring; fetchOptions?: FetchOptions } = {}
): CalendarProvider {
	const db = deps.db ?? getDb();
	const keyring = deps.keyring ?? getKeyring();
	return {
		async listCalendars(): Promise<RemoteCalendar[]> {
			const url = openUrl(keyring, source);
			return [
				{
					externalId: calendarIdFor(url),
					name: readCache(db, source.id)?.name ?? source.label
				}
			];
		},
		async fetchEvents(): Promise<RemoteEvent[]> {
			const url = openUrl(keyring, source);
			const cache = readCache(db, source.id);
			const { entry, fresh } = await load(url, cache, deps.fetchOptions ?? {});
			if (fresh) writeCache(db, source.id, entry);
			return entry.events;
		}
	};
}

providerRegistry.ics = (source) => createIcsProvider(source);
