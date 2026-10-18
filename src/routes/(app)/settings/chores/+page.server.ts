import { getDb } from '#lib/server/db/index.js';
import { approvalDefault } from '#lib/server/domain/approval-setting.js';
import { listChores } from '#lib/server/domain/chores.js';
import { listMembers } from '#lib/server/domain/members.js';
import type { PageServerLoad } from './$types';

// Mutations go through the JSON API (/api/chores); plain form POSTs trip SvelteKit's CSRF
// origin check over plain HTTP (see the family page).
export const load: PageServerLoad = () => ({
	chores: listChores(getDb(), { kind: 'star_job' }),
	members: listMembers(getDb()),
	approvalDefault: approvalDefault(getDb())
});
