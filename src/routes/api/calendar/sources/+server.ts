import { randomUUID } from 'node:crypto';
import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { getDb } from '#lib/server/db/index.js';
import { calendarSources, members } from '#lib/server/db/schema.js';
import { readJson, str } from '#lib/server/api.js';
import { requireAdult } from '#lib/server/auth.js';
import { getKeyring } from '#lib/server/keys.js';
import { IcsError, normalizeUrl, probeIcs, sealUrl } from '#lib/server/calendar/ics.js';
import { addIcloudSource } from '#lib/server/calendar/icloud-add.js';
import { listSources } from '#lib/server/calendar/sources.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => {
	requireAdult(event);
	return json(listSources(getDb()));
};

export const POST: RequestHandler = async (event) => {
	requireAdult(event);
	const body = await readJson(event.request);
	if (body.provider === 'icloud') return addIcloudSource(body);
	if (body.provider !== 'ics') error(400, 'Only providers "ics" and "icloud" can be added here');
	const label = str(body.label, 'label');
	const memberId = typeof body.memberId === 'string' && body.memberId ? body.memberId : null;
	const db = getDb();
	if (memberId && !db.select().from(members).where(eq(members.id, memberId)).get())
		error(400, 'Unknown member');
	if (typeof body.url !== 'string' || !body.url.trim()) error(400, 'url is required');

	let probe;
	let url;
	try {
		url = normalizeUrl(body.url).href;
		probe = await probeIcs(url);
	} catch (e) {
		if (e instanceof IcsError) error(400, e.message);
		throw e;
	}
	const id = randomUUID();
	const row = {
		id,
		provider: 'ics' as const,
		label,
		credentials: sealUrl(getKeyring(), id, url),
		calendars: JSON.stringify([
			{ externalId: probe.externalId, name: probe.name ?? label, memberId }
		])
	};
	db.insert(calendarSources).values(row).run();
	return json(
		{ ...listSources(db).find((s) => s.id === id), events: probe.events.length },
		{ status: 201 }
	);
};
