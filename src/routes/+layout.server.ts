import { isAdult } from '#lib/server/auth.js';
import type { LayoutServerLoad } from './$types';

/** Whether an adult session is active, so the header can offer Lock (never the adult's identity). */
export const load: LayoutServerLoad = (event) => ({ adult: isAdult(event) });
