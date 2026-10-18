import type { Db } from '../db/index.js';
import { calendarSources } from '../db/schema.js';
import {
	NewEventError,
	resolveNewEvent,
	type NewEventInput
} from '../domain/calendar/new-event.js';
import { householdTimeZone } from '../household.js';
import { createProvider, type CalendarProvider, type CalendarSource } from './provider.js';
import { syncSource } from './sync.js';

/** A failure with an HTTP status and a message that is safe to show an adult. */
export class CreateEventError extends Error {
	constructor(
		readonly status: 400 | 401 | 404 | 502,
		message: string
	) {
		super(message);
	}
}

interface Mapping {
	externalId: string;
	selected?: boolean;
}

/** The writable calendar the household has added: an iCloud source's shown calendar. */
function findSource(db: Db, calendarId: string): CalendarSource | undefined {
	return db
		.select()
		.from(calendarSources)
		.all()
		.find((s) => {
			if (s.provider !== 'icloud') return false;
			const cals: unknown = JSON.parse(s.calendars);
			return (
				Array.isArray(cals) &&
				(cals as Mapping[]).some((c) => c.externalId === calendarId && c.selected !== false)
			);
		});
}

export interface CreateEventDeps {
	provider?: (source: CalendarSource) => CalendarProvider | Promise<CalendarProvider>;
}

/** CAL-9: writes a new event to the chosen iCloud calendar, then refreshes that source. */
export async function createCalendarEvent(
	db: Db,
	body: Record<string, unknown>,
	deps: CreateEventDeps = {}
): Promise<{ uid: string }> {
	if (typeof body.calendarId !== 'string' || !body.calendarId)
		throw new CreateEventError(400, 'calendarId is required');
	let resolved;
	try {
		resolved = resolveNewEvent(body as unknown as NewEventInput, householdTimeZone(db));
	} catch (e) {
		if (e instanceof NewEventError) throw new CreateEventError(400, e.message);
		throw e;
	}
	const source = findSource(db, body.calendarId);
	if (!source) throw new CreateEventError(404, 'That calendar is not available for new events');
	const provider = await (deps.provider ?? createProvider)(source);
	if (!provider.createEvent)
		throw new CreateEventError(400, 'That calendar cannot take new events');
	let uid: string;
	try {
		({ uid } = await provider.createEvent(body.calendarId, resolved));
	} catch (e) {
		// Provider messages are already secret-free (IcloudError); anything else is not trusted.
		const safe = e instanceof Error && e.name === 'IcloudError';
		if ((e as { needsReauth?: boolean }).needsReauth === true && safe)
			throw new CreateEventError(401, (e as Error).message);
		throw new CreateEventError(502, safe ? (e as Error).message : 'Could not save the event');
	}
	// Pull the fresh calendar so the hub's cache matches Apple. Never throws.
	await syncSource(db, source, deps.provider ? { provider: deps.provider } : {});
	return { uid };
}
