import { matchName, parseStars, spokenList, SIRI_STARS_MAX } from '#lib/domain/siri.js';
import { localDate } from '#lib/server/api.js';
import { getDb } from '#lib/server/db/index.js';
import { createChore } from '#lib/server/domain/chores.js';
import { members } from '#lib/server/db/schema.js';
import { eq } from 'drizzle-orm';
import { authenticate, badRequest, readBody, reply, spokenError } from '#lib/server/siri.js';
import type { RequestHandler } from './$types';

/** Body: { title, stars?, kid? }. Creates a one-off Star Job for today (approval stays on). */
export const POST: RequestHandler = async ({ request }) => {
	const auth = authenticate(request, 'chores:create');
	if ('response' in auth) return auth.response;
	const body = await readBody(request);
	if (!body) return badRequest('I could not read that request.');
	const title = typeof body.title === 'string' ? body.title.replace(/\s+/g, ' ').trim() : '';
	if (title.length < 1 || title.length > 60)
		return badRequest('Tell me the Star Job, in up to 60 characters.');
	const stars = parseStars(body.stars);
	if (stars === null)
		return badRequest(`Stars must be a whole number from 1 to ${SIRI_STARS_MAX}.`);

	const db = getDb();
	const kids = db.select().from(members).where(eq(members.role, 'child')).all();
	const names = kids.map((k) => k.name);
	let kid: (typeof kids)[number] | undefined;
	const asked = typeof body.kid === 'string' && body.kid.trim() !== '';
	if (asked) {
		const hit = matchName(body.kid, kids, (k) => k.name);
		if (hit.kind !== 'match')
			return reply({
				ok: false,
				kids: names,
				speak:
					hit.kind === 'none'
						? `I could not find that kid. The kids are ${spokenList(names)}.`
						: `Which kid? ${spokenList(hit.options.map((k) => k.name))}.`
			});
		kid = hit.value;
	} else if (kids.length === 1) kid = kids[0];
	else if (kids.length > 1)
		return reply({ ok: false, kids: names, speak: `Who is it for? ${spokenList(names)}.` });

	try {
		const chore = createChore(db, {
			title,
			kind: 'star_job',
			stars,
			memberIds: kid ? [kid.id] : [],
			schedule: { type: 'once', start: localDate(Date.now()) }
		});
		return reply({
			ok: true,
			id: chore.id,
			stars: chore.stars,
			speak: `Added a ${chore.stars}-star job, ${title}${kid ? `, for ${kid.name}` : ''}.`
		});
	} catch (e) {
		return spokenError(e);
	}
};
