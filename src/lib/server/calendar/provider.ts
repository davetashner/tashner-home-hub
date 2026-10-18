import type { schema } from '../db/index.js';
import type { NewEvent } from '../domain/calendar/ics-build.js';
import type { RemoteCalendar, RemoteEvent, Window } from '../domain/calendar/types.js';

export type { RemoteCalendar, RemoteEvent, RemoteTime, Window } from '../domain/calendar/types.js';

/** What the sync engine needs from a calendar backend (Google, iCloud CalDAV, ICS). */
export interface CalendarProvider {
	listCalendars(): Promise<RemoteCalendar[]>;
	/** Raw events (masters and overrides, unexpanded) that may overlap `window`. */
	fetchEvents(calendarId: string, window: Window): Promise<RemoteEvent[]>;
	/** Writes a new event to `calendarId` (CAL-9). Absent on read-only providers. Returns the new UID. */
	createEvent?(calendarId: string, event: NewEvent): Promise<{ uid: string }>;
}

export type CalendarSource = typeof schema.calendarSources.$inferSelect;
export type ProviderFactory = (
	source: CalendarSource
) => CalendarProvider | Promise<CalendarProvider>;

const notImplemented =
	(name: string): ProviderFactory =>
	() => {
		throw new Error(`${name} provider is not implemented yet`);
	};

/** Provider type to factory. Real connectors replace these entries in their own beads. */
export const providerRegistry: Record<CalendarSource['provider'], ProviderFactory> = {
	google: notImplemented('Google'),
	icloud: notImplemented('iCloud'),
	ics: notImplemented('ICS')
};

export function createProvider(
	source: CalendarSource
): CalendarProvider | Promise<CalendarProvider> {
	return providerRegistry[source.provider](source);
}

/** In-memory provider for tests and local development. */
export class FakeProvider implements CalendarProvider {
	constructor(
		public calendars: Record<string, RemoteEvent[]> = {},
		public failing = new Set<string>()
	) {}

	async listCalendars(): Promise<RemoteCalendar[]> {
		return Object.keys(this.calendars).map((externalId) => ({ externalId, name: externalId }));
	}

	async fetchEvents(calendarId: string): Promise<RemoteEvent[]> {
		if (this.failing.has(calendarId)) throw new Error(`fetch failed for ${calendarId}`);
		const events = this.calendars[calendarId];
		if (!events) throw new Error(`unknown calendar ${calendarId}`);
		return events;
	}
}
