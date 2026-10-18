import {
	createCalendarObject,
	createDAVClient,
	deleteCalendarObject,
	fetchCalendarObjects,
	updateCalendarObject,
	getBasicAuthHeaders
} from 'tsdav';
import { getDb } from '../db/index.js';
import { householdTimeZone } from '../household.js';
import { buildEventIcs, newUid, type NewEvent } from '../domain/calendar/ics-build.js';
import { expandAll } from '../domain/calendar/expand.js';
import { uneditableReason, modifyEventIcs } from '../domain/calendar/ics-modify.js';
import { parseIcs } from '../domain/calendar/ics-parse.js';
import { decryptSecret, encryptSecret, type Keyring } from '../domain/secrets.js';
import { getKeyring } from '../keys.js';
import {
	providerRegistry,
	type CalendarProvider,
	type CalendarSource,
	type EditFailure,
	type EventRef,
	type RemoteCalendar,
	type RemoteEvent,
	type Window
} from './provider.js';

export const ICLOUD_URL = 'https://caldav.icloud.com';
export const REQUEST_TIMEOUT_MS = 20_000;

/** Shown to an adult when Apple answers 401. Also how sync status is recognised as "needs re-auth". */
export const REAUTH_MESSAGE =
	'Apple rejected the app-specific password. Create a new one at appleid.apple.com > Sign-In and Security > App-Specific Passwords, then re-add this calendar.';

/** A failure with a message that is safe to show an adult (never contains the Apple ID or password). */
export class IcloudError extends Error {
	constructor(
		message: string,
		readonly needsReauth = false,
		/** Set when an edit or delete was refused for a reason the adult can act on. */
		readonly code?: EditFailure
	) {
		super(message);
		this.name = 'IcloudError';
	}
}

export interface IcloudCredentials {
	appleId: string;
	appPassword: string;
}

export interface IcloudOptions {
	/** Override for tests; defaults to Apple's CalDAV endpoint. */
	serverUrl?: string;
	timeoutMs?: number;
}

/** `jane@example.com` becomes `j•••@example.com`. */
export function maskAppleId(appleId: string): string {
	const at = appleId.indexOf('@');
	if (at < 1) return appleId ? `${appleId[0]}•••` : '';
	return `${appleId[0]}•••${appleId.slice(at)}`;
}

const aad = (sourceId: string) => `calendar_source:${sourceId}`;

export function sealCredentials(
	keyring: Keyring,
	sourceId: string,
	creds: IcloudCredentials
): string {
	return encryptSecret(keyring, JSON.stringify(creds), aad(sourceId));
}

export function openCredentials(
	keyring: Keyring,
	source: Pick<CalendarSource, 'id' | 'credentials'>
): IcloudCredentials {
	if (!source.credentials) throw new IcloudError('This calendar has no stored credentials');
	return JSON.parse(
		decryptSecret(keyring, source.credentials, aad(source.id))
	) as IcloudCredentials;
}

/** Maps any tsdav/network failure to a fixed, secret-free message. */
function friendly(e: unknown, signal?: AbortSignal): IcloudError {
	if (e instanceof IcloudError) return e;
	const msg = e instanceof Error ? e.message : '';
	if (/\b401\b|Invalid credentials|Unauthorized/i.test(msg)) {
		return new IcloudError(REAUTH_MESSAGE, true);
	}
	if (signal?.aborted) return new IcloudError('Apple took too long to respond');
	if (/\b(403|404|5\d\d)\b/.test(msg)) return new IcloudError('Apple answered with an error');
	return new IcloudError('Could not reach Apple calendar servers');
}

function guarded(opts: IcloudOptions): { signal: AbortSignal; fetch: typeof fetch } {
	const signal = AbortSignal.timeout(opts.timeoutMs ?? REQUEST_TIMEOUT_MS);
	return { signal, fetch: (input, init) => fetch(input, { ...init, signal }) };
}

/** Discovers the account's event calendars (reminder lists are skipped). */
export async function discoverCalendars(
	creds: IcloudCredentials,
	opts: IcloudOptions = {}
): Promise<RemoteCalendar[]> {
	const { signal, fetch: f } = guarded(opts);
	try {
		const client = await createDAVClient({
			serverUrl: opts.serverUrl ?? ICLOUD_URL,
			credentials: { username: creds.appleId, password: creds.appPassword },
			authMethod: 'Basic',
			defaultAccountType: 'caldav',
			fetch: f
		});
		const cals = await client.fetchCalendars();
		return cals
			.filter((c) => !c.components || c.components.length === 0 || c.components.includes('VEVENT'))
			.map((c) => ({
				externalId: c.url,
				name: typeof c.displayName === 'string' && c.displayName ? c.displayName : 'Calendar'
			}));
	} catch (e) {
		throw friendly(e, signal);
	}
}

export async function fetchIcloudEvents(
	creds: IcloudCredentials,
	calendarId: string,
	window: Window,
	householdZone: string,
	opts: IcloudOptions = {}
): Promise<RemoteEvent[]> {
	const { signal, fetch: f } = guarded(opts);
	try {
		const objects = await fetchCalendarObjects({
			calendar: { url: calendarId },
			timeRange: {
				start: new Date(window.start).toISOString(),
				end: new Date(window.end).toISOString()
			},
			useMultiGet: false,
			headers: getBasicAuthHeaders({ username: creds.appleId, password: creds.appPassword }),
			fetch: f
		});
		const out: RemoteEvent[] = [];
		for (const o of objects) {
			if (typeof o.data !== 'string') continue;
			try {
				out.push(...parseIcs(o.data, householdZone).events);
			} catch {
				// One unreadable object must not hide the rest of the calendar.
			}
		}
		return out;
	} catch (e) {
		throw friendly(e, signal);
	}
}

/** PUTs a new VEVENT (`<uid>.ics`) into the calendar. Fails if Apple already has that name. */
export async function createIcloudEvent(
	creds: IcloudCredentials,
	calendarId: string,
	event: NewEvent,
	opts: IcloudOptions = {}
): Promise<{ uid: string }> {
	const { signal, fetch: f } = guarded(opts);
	const uid = newUid();
	try {
		const res = await createCalendarObject({
			calendar: { url: calendarId },
			filename: `${uid}.ics`,
			iCalString: buildEventIcs(event, { uid, now: Date.now() }),
			headers: getBasicAuthHeaders({ username: creds.appleId, password: creds.appPassword }),
			fetch: f
		});
		// tsdav returns the response rather than throwing on a refusal.
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		return { uid };
	} catch (e) {
		throw friendly(e, signal);
	}
}

/** Shown when Apple's copy differs from what the hub displayed (HTTP 412 or a field mismatch). */
export const CHANGED_MESSAGE = 'This event changed on another device — check it and try again.';
export const RECURRING_MESSAGE = 'This event repeats. Edit this on your phone.';
const DAY = 86_400_000;

interface Located {
	url: string;
	etag: string | undefined;
	data: string;
}

/**
 * Reads the event's CalDAV object fresh from Apple (its URL, ETag and current text), and checks
 * that it is still the plain, unchanged event the hub showed. The hub's cache keeps neither the
 * URL nor the ETag, so each write starts from this read; comparing against the cached fields is
 * what turns "someone edited it on their phone since the last sync" into a clear conflict.
 */
async function locate(
	creds: IcloudCredentials,
	ref: EventRef,
	f: typeof fetch,
	householdZone: string
): Promise<Located> {
	const w = {
		start: ref.cached.startsAt - DAY,
		end: Math.max(ref.cached.endsAt, ref.cached.startsAt + 1) + DAY
	};
	const objects = await fetchCalendarObjects({
		calendar: { url: ref.calendarId },
		timeRange: { start: new Date(w.start).toISOString(), end: new Date(w.end).toISOString() },
		useMultiGet: false,
		headers: getBasicAuthHeaders({ username: creds.appleId, password: creds.appPassword }),
		fetch: f
	});
	for (const o of objects) {
		if (typeof o.data !== 'string' || typeof o.url !== 'string') continue;
		let events;
		try {
			events = parseIcs(o.data, householdZone).events;
		} catch {
			continue;
		}
		if (!events.some((e) => e.uid === ref.uid)) continue;
		if (uneditableReason(o.data) === 'recurring')
			throw new IcloudError(RECURRING_MESSAGE, false, 'recurring');
		const now = expandAll(events, w).find((i) => i.externalId === `${ref.uid}::${ref.instance}`);
		const c = ref.cached;
		if (
			!now ||
			now.title !== c.title ||
			now.startsAt !== c.startsAt ||
			now.endsAt !== c.endsAt ||
			now.allDay !== c.allDay ||
			now.location !== c.location ||
			now.notes !== c.notes
		)
			throw new IcloudError(CHANGED_MESSAGE, false, 'changed');
		return { url: o.url, etag: o.etag, data: o.data };
	}
	throw new IcloudError(CHANGED_MESSAGE, false, 'changed');
}

/** PUTs the edited object with `If-Match: <etag>`. A 412 means it changed since we read it. */
export async function updateIcloudEvent(
	creds: IcloudCredentials,
	ref: EventRef,
	event: NewEvent,
	householdZone: string,
	opts: IcloudOptions = {}
): Promise<void> {
	const { signal, fetch: f } = guarded(opts);
	try {
		const found = await locate(creds, ref, f, householdZone);
		const res = await updateCalendarObject({
			calendarObject: {
				url: found.url,
				etag: found.etag,
				data: modifyEventIcs(found.data, event, Date.now())
			},
			headers: getBasicAuthHeaders({ username: creds.appleId, password: creds.appPassword }),
			fetch: f
		});
		if (res.status === 412) throw new IcloudError(CHANGED_MESSAGE, false, 'changed');
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
	} catch (e) {
		throw friendly(e, signal);
	}
}

/** DELETEs the event's object with `If-Match: <etag>`. Already gone (404) counts as deleted. */
export async function deleteIcloudEvent(
	creds: IcloudCredentials,
	ref: EventRef,
	householdZone: string,
	opts: IcloudOptions = {}
): Promise<void> {
	const { signal, fetch: f } = guarded(opts);
	try {
		const found = await locate(creds, ref, f, householdZone);
		const res = await deleteCalendarObject({
			calendarObject: { url: found.url, etag: found.etag, data: found.data },
			headers: getBasicAuthHeaders({ username: creds.appleId, password: creds.appPassword }),
			fetch: f
		});
		if (res.status === 412) throw new IcloudError(CHANGED_MESSAGE, false, 'changed');
		if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
	} catch (e) {
		throw friendly(e, signal);
	}
}

export function createIcloudProvider(
	source: CalendarSource,
	deps: { keyring?: Keyring; options?: IcloudOptions } = {}
): CalendarProvider {
	const keyring = deps.keyring ?? getKeyring();
	const options = deps.options ?? {};
	return {
		listCalendars: () => discoverCalendars(openCredentials(keyring, source), options),
		fetchEvents: (calendarId, window) =>
			fetchIcloudEvents(
				openCredentials(keyring, source),
				calendarId,
				window,
				householdTimeZone(getDb()),
				options
			),
		createEvent: (calendarId, event) =>
			createIcloudEvent(openCredentials(keyring, source), calendarId, event, options),
		updateEvent: (ref, event) =>
			updateIcloudEvent(
				openCredentials(keyring, source),
				ref,
				event,
				householdTimeZone(getDb()),
				options
			),
		deleteEvent: (ref) =>
			deleteIcloudEvent(openCredentials(keyring, source), ref, householdTimeZone(getDb()), options)
	};
}

/** Validates credentials by connecting once. Throws IcloudError with a friendly reason. */
export async function probeIcloud(
	creds: IcloudCredentials,
	opts: IcloudOptions = {}
): Promise<RemoteCalendar[]> {
	const cals = await discoverCalendars(creds, opts);
	if (cals.length === 0) throw new IcloudError('No calendars were found on that Apple account');
	return cals;
}

providerRegistry.icloud = (source) => createIcloudProvider(source);
