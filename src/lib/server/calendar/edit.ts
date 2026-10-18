import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { calendarSources, events } from '../db/schema.js';
import { parseScopedId } from '../domain/calendar/diff.js';
import {
	NewEventError,
	resolveNewEvent,
	type NewEventInput
} from '../domain/calendar/new-event.js';
import { householdTimeZone } from '../household.js';
import {
	createProvider,
	type CalendarProvider,
	type CalendarSource,
	type EventRef
} from './provider.js';
import { syncSource } from './sync.js';

/** A failure with an HTTP status and a message that is safe to show an adult. */
export class EditEventError extends Error {
	constructor(
		readonly status: 400 | 401 | 404 | 409 | 502,
		message: string
	) {
		super(message);
	}
}

export interface EditEventDeps {
	provider?: (source: CalendarSource) => CalendarProvider | Promise<CalendarProvider>;
}

function target(db: Db, id: string): { source: CalendarSource; ref: EventRef } {
	const row = db.select().from(events).where(eq(events.id, id)).get();
	if (!row) throw new EditEventError(404, 'That event no longer exists');
	const source = db
		.select()
		.from(calendarSources)
		.where(eq(calendarSources.id, row.sourceId))
		.get();
	const parsed = parseScopedId(row.externalId);
	if (!source || !parsed) throw new EditEventError(404, 'That event no longer exists');
	if (source.provider !== 'icloud')
		throw new EditEventError(400, 'Only iCloud events can be changed from the hub for now');
	return {
		source,
		ref: {
			...parsed,
			cached: {
				title: row.title,
				startsAt: row.startsAt,
				endsAt: row.endsAt,
				allDay: row.allDay,
				location: row.location,
				notes: row.notes
			}
		}
	};
}

/** Runs the write, maps provider failures to adult-safe errors, then refetches the source. */
async function write(
	db: Db,
	source: CalendarSource,
	deps: EditEventDeps,
	op: (p: CalendarProvider) => Promise<void> | undefined
): Promise<void> {
	const provider = await (deps.provider ?? createProvider)(source);
	let failure: EditEventError | undefined;
	try {
		const run = op(provider);
		if (!run) throw new EditEventError(400, 'That calendar cannot be changed from the hub');
		await run;
	} catch (e) {
		if (e instanceof EditEventError) throw e;
		// Provider messages are already secret-free (IcloudError); anything else is not trusted.
		const safe = e instanceof Error && e.name === 'IcloudError';
		const code = (e as { code?: string }).code;
		if (safe && (e as { needsReauth?: boolean }).needsReauth === true)
			throw new EditEventError(401, (e as Error).message);
		failure = new EditEventError(
			safe && (code === 'changed' || code === 'recurring') ? 409 : 502,
			safe ? (e as Error).message : 'Could not save the change'
		);
	}
	// Pull the fresh calendar either way: after a conflict this is the "refetch" so the adult sees
	// what changed. Never throws.
	await syncSource(db, source, deps.provider ? { provider: deps.provider } : {});
	if (failure) throw failure;
}

/** CAL-9: rewrites a non-recurring iCloud event with the edited fields. */
export async function updateCalendarEvent(
	db: Db,
	id: string,
	body: Record<string, unknown>,
	deps: EditEventDeps = {}
): Promise<void> {
	let resolved;
	try {
		resolved = resolveNewEvent(body as unknown as NewEventInput, householdTimeZone(db));
	} catch (e) {
		if (e instanceof NewEventError) throw new EditEventError(400, e.message);
		throw e;
	}
	const { source, ref } = target(db, id);
	await write(db, source, deps, (p) => p.updateEvent?.(ref, resolved));
}

/** CAL-9: removes a non-recurring iCloud event. */
export async function deleteCalendarEvent(
	db: Db,
	id: string,
	deps: EditEventDeps = {}
): Promise<void> {
	const { source, ref } = target(db, id);
	await write(db, source, deps, (p) => p.deleteEvent?.(ref));
}
