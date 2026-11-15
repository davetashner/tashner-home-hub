import { getDb } from '#lib/server/db/index.js';
import { listMembers } from '#lib/server/domain/members.js';
import type { PageServerLoad } from './$types';

// Mutations go through the JSON API; plain form POSTs trip SvelteKit's CSRF origin check over HTTP.
export const load: PageServerLoad = () => ({
	kids: listMembers(getDb())
		.filter((m) => m.role === 'child')
		.map((m) => ({ id: m.id, name: m.name }))
});
