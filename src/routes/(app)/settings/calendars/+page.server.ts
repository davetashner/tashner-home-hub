import { getDb } from '#lib/server/db/index.js';
import { listMembers } from '#lib/server/domain/members.js';
import { listSources } from '#lib/server/calendar/sources.js';
import type { PageServerLoad } from './$types';

// Mutations go through the JSON API (/api/calendar/*), never form actions.
export const load: PageServerLoad = () => {
	const db = getDb();
	return {
		sources: listSources(db),
		people: listMembers(db).map(({ id, name, color, avatar }) => ({ id, name, color, avatar }))
	};
};
