import { getDb } from '#lib/server/db/index.js';
import { listMembers } from '#lib/server/domain/members.js';
import type { PageServerLoad } from './$types';

/** The kids the info card has a row for. The card itself loads through the adult-only API. */
export const load: PageServerLoad = () => ({
	kids: listMembers(getDb())
		.filter((m) => m.role === 'child')
		.map((m) => ({ id: m.id, name: m.name }))
});
