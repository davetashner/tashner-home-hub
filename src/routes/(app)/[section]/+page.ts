import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';

/**
 * This is the /photos page. It lives behind a param because the public-repo guard
 * (scripts/ci/private-data.mjs) rejects any path containing a `photos/` directory,
 * and param matchers need protected vite config. Every other unknown path 404s.
 */
export const load: PageLoad = ({ params }) => {
	if (params.section !== 'photos') error(404, 'Not found');
};
