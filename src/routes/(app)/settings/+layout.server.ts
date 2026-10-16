import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

/** Settings are grown-ups only: without an adult session, unlock first and come back. */
export const load: LayoutServerLoad = ({ locals, url }) => {
	if (!locals.adult) redirect(303, `/unlock?next=${encodeURIComponent(url.pathname + url.search)}`);
};
