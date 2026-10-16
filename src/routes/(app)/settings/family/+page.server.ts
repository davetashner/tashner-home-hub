import { getDb } from '#lib/server/db/index.js';
import { listMembers } from '#lib/server/domain/members.js';
import type { PageServerLoad } from './$types';

// Mutations go through the JSON API (/api/members); plain form POSTs would trip SvelteKit's
// CSRF origin check behind adapter-node over plain HTTP without ORIGIN/PROTOCOL_HEADER.
export const load: PageServerLoad = () => ({ members: listMembers(getDb()) });
