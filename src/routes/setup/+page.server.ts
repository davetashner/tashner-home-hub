import { redirect } from '@sveltejs/kit';
import { hubNeedsSetup } from '#lib/server/setup-state.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	if (!hubNeedsSetup()) redirect(303, '/');
};
