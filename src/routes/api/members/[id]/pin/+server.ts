import { error, json } from '@sveltejs/kit';
import { eq, isNotNull } from 'drizzle-orm';
import { getDb, schema } from '#lib/server/db/index.js';
import { currentAdult, revokeSessions } from '#lib/server/auth.js';
import { hashPin, validatePin } from '#lib/server/domain/pin.js';
import type { RequestHandler } from './$types';

/** Set or change an adult's PIN. Needs an adult session, except for first-run setup (no adult has a PIN yet). */
export const POST: RequestHandler = async (event) => {
	const db = getDb();
	const anyPin = db
		.select({ id: schema.members.id })
		.from(schema.members)
		.where(isNotNull(schema.members.pinHash))
		.limit(1)
		.get();
	if (anyPin && !currentAdult(event)) error(401, 'Adult PIN required');

	const body = (await event.request.json().catch(() => null)) as { pin?: unknown } | null;
	const check = validatePin(body?.pin);
	if (!check.ok) error(400, check.message);

	const member = db
		.select()
		.from(schema.members)
		.where(eq(schema.members.id, event.params.id))
		.get();
	if (!member) error(404, 'Member not found');
	if (member.role !== 'adult') error(400, 'Only adults have a PIN');

	db.update(schema.members)
		.set({ pinHash: hashPin(body!.pin as string) })
		.where(eq(schema.members.id, member.id))
		.run();
	// A changed PIN must also end any session obtained with the old one.
	revokeSessions(member.id);
	return json({ ok: true });
};
