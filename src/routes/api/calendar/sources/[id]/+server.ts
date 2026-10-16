import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { getDb } from '#lib/server/db/index.js';
import { calendarSources, members } from '#lib/server/db/schema.js';
import { readJson, str } from '#lib/server/api.js';
import { requireAdult } from '#lib/server/auth.js';
import { clearIcsCache } from '#lib/server/calendar/ics.js';
import {
	IcloudError,
	openCredentials,
	probeIcloud,
	sealCredentials
} from '#lib/server/calendar/icloud.js';
import { getKeyring } from '#lib/server/keys.js';
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
	const set: { label?: string; calendars?: string; credentials?: string } = {};
	if (body.label !== undefined) set.label = str(body.label, 'label');
	if (body.appPassword !== undefined) {
		// Re-auth for iCloud: a new app-specific password (Apple ID kept unless sent too).
		if (source.provider !== 'icloud') error(400, 'Only iCloud sources take a new password');
		const appPassword = str(body.appPassword, 'appPassword').trim();
		let appleId: string;
		try {
			appleId =
				typeof body.appleId === 'string' && body.appleId.trim()
					? body.appleId.trim()
					: openCredentials(getKeyring(), source).appleId;
			await probeIcloud({ appleId, appPassword });
		} catch (e) {
			if (e instanceof IcloudError) error(e.needsReauth ? 401 : 400, e.message);
			throw e;
		}
		set.credentials = sealCredentials(getKeyring(), source.id, { appleId, appPassword });
	}

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
