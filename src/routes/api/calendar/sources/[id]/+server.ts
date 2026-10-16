import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { getDb } from '#lib/server/db/index.js';
import { calendarSources, members } from '#lib/server/db/schema.js';
import { readJson, str } from '#lib/server/api.js';
import { requireAdult } from '#lib/server/auth.js';
import { clearIcsCache } from '#lib/server/calendar/ics.js';
import { getSource, viewOf } from '#lib/server/calendar/sources.js';
import { readStatuses } from '#lib/server/calendar/sync.js';
import type { RequestHandler } from './$types';

interface Mapping {
	externalId: string;
	name: string;
	memberId?: string | null;
	selected?: boolean;
}

/** Updates the label and/or which member each calendar belongs to. Works for every provider. */
export const PATCH: RequestHandler = async (event) => {
	requireAdult(event);
	const db = getDb();
	const source = getSource(db, event.params.id);
	if (!source) error(404, 'Calendar source not found');
	const body = await readJson(event.request);
	const set: { label?: string; calendars?: string } = {};
	if (body.label !== undefined) set.label = str(body.label, 'label');

	const memberOk = (m: unknown): string | null => {
		if (m === null || m === '') return null;
		if (typeof m !== 'string' || !db.select().from(members).where(eq(members.id, m)).get())
			error(400, 'Unknown member');
		return m;
	};
	const patchCal = (c: Mapping, w: { memberId?: unknown; selected?: unknown }): Mapping => ({
		...c,
		...(w.memberId !== undefined ? { memberId: memberOk(w.memberId) } : {}),
		...(typeof w.selected === 'boolean' ? { selected: w.selected } : {})
	});
	const cals = JSON.parse(source.calendars) as Mapping[];
	if (body.memberId !== undefined) {
		const m = memberOk(body.memberId);
		set.calendars = JSON.stringify(cals.map((c) => ({ ...c, memberId: m })));
	} else if (Array.isArray(body.calendars)) {
		const wanted = new Map(
			(body.calendars as { externalId?: unknown; memberId?: unknown; selected?: unknown }[]).map(
				(c) => [c.externalId, c]
			)
		);
		set.calendars = JSON.stringify(
			cals.map((c) => (wanted.has(c.externalId) ? patchCal(c, wanted.get(c.externalId)!) : c))
		);
	}
	if (Object.keys(set).length === 0) error(400, 'Nothing to update');
	db.update(calendarSources).set(set).where(eq(calendarSources.id, source.id)).run();
	return json(viewOf(getSource(db, source.id)!, readStatuses(db)));
};

/** Removes a source; its events cascade away. */
export const DELETE: RequestHandler = (event) => {
	requireAdult(event);
	const db = getDb();
	const source = getSource(db, event.params.id);
	if (!source) error(404, 'Calendar source not found');
	db.delete(calendarSources).where(eq(calendarSources.id, source.id)).run();
	clearIcsCache(db, source.id);
	return new Response(null, { status: 204 });
};
