import { getDb } from '#lib/server/db/index.js';
import { listSources } from '#lib/server/calendar/sources.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({
	reauth: listSources(getDb())
		.filter((s) => s.needsReauth)
		.map(({ id, label }) => ({ id, label }))
});
