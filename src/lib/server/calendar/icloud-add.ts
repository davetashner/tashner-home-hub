import { randomUUID } from 'node:crypto';
import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { calendarSources, members } from '../db/schema.js';
import { str } from '../api.js';
import { getKeyring } from '../keys.js';
import { IcloudError, probeIcloud, sealCredentials, type IcloudOptions } from './icloud.js';
import { listSources } from './sources.js';

/** POST handler body for `{provider:'icloud', label, appleId, appPassword}`. */
export async function addIcloudSource(
	body: Record<string, unknown>,
	opts: IcloudOptions = {}
): Promise<Response> {
	const label = str(body.label, 'label');
	const appleId = str(body.appleId, 'appleId').trim();
	const appPassword = str(body.appPassword, 'appPassword').trim();
	const memberId = typeof body.memberId === 'string' && body.memberId ? body.memberId : null;
	const db = getDb();
	if (memberId && !db.select().from(members).where(eq(members.id, memberId)).get())
		error(400, 'Unknown member');

	let found;
	try {
		found = await probeIcloud({ appleId, appPassword }, opts);
	} catch (e) {
		if (e instanceof IcloudError) error(e.needsReauth ? 401 : 400, e.message);
		throw e;
	}
	const id = randomUUID();
	db.insert(calendarSources)
		.values({
			id,
			provider: 'icloud',
			label,
			credentials: sealCredentials(getKeyring(), id, { appleId, appPassword }),
			// All discovered calendars are stored; the adult picks which to show via PATCH.
			calendars: JSON.stringify(
				found.map((c) => ({ externalId: c.externalId, name: c.name, memberId, selected: false }))
			)
		})
		.run();
	return json(
		listSources(db).find((s) => s.id === id),
		{ status: 201 }
	);
}
