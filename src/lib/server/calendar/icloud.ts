import { createDAVClient, fetchCalendarObjects, getBasicAuthHeaders } from 'tsdav';
import { parseIcs } from '../domain/calendar/ics-parse.js';
import { decryptSecret, encryptSecret, type Keyring } from '../domain/secrets.js';
import { getKeyring } from '../keys.js';
import {
	providerRegistry,
	type CalendarProvider,
	type CalendarSource,
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
		readonly needsReauth = false
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

const householdZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

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
				householdZone(),
				options
			)
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
