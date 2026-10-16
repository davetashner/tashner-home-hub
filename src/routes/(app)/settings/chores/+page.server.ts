import { getDb } from '#lib/server/db/index.js';
import { listChores } from '#lib/server/domain/chores.js';
import { listMembers } from '#lib/server/domain/members.js';
import type { PageServerLoad } from './$types';

// Mutations go through the JSON API (/api/chores); plain form POSTs trip SvelteKit's CSRF
// origin check over plain HTTP (see the family page).
export const load: PageServerLoad = () => ({
	chores: listChores(getDb()),
	members: listMembers(getDb())
});
