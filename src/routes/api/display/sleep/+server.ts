import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** Stub: the Pi display agent integration lands with hub-xcr.2. */
export const POST: RequestHandler = () => json({ requested: 'sleep' }, { status: 202 });
