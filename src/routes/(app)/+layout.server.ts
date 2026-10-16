import { redirect } from '@sveltejs/kit';
import { hubNeedsSetup } from '#lib/server/setup-state.js';
import type { LayoutServerLoad } from './$types';

/** A fresh install has no adult to unlock anything: send every screen to the setup flow. */
export const load: LayoutServerLoad = () => {
	if (hubNeedsSetup()) redirect(303, '/setup');
};
