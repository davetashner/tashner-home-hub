import { resolve } from '$app/paths';
import type { DestinationPath } from '#lib/domain/nav.js';

/**
 * Base-path-aware URLs for the main destinations (photos goes through a param
 * matcher, see src/routes/(app)/[section]/+page.ts). Built with resolve() so links honour the base path.
 */
export const DESTINATION_URLS: Record<DestinationPath, string> = {
	'/calendar': resolve('/(app)/calendar'),
	'/chores': resolve('/(app)/chores'),
	'/photos': resolve('/(app)/[section]', { section: 'photos' }),
	'/lists': resolve('/(app)/lists'),
	'/meals': resolve('/(app)/meals'),
	'/games': resolve('/(app)/games')
};
