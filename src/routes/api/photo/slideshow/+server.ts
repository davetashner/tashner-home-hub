import { json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { slideshow } from '#lib/server/photo-source/service.js';
import type { RequestHandler } from './$types';

/** Open to the LAN like /api/photo/[id]: the wall display has no session. Stable order per `seed`. */
export const GET: RequestHandler = ({ url }) => {
	const limit = Math.min(2000, Math.max(1, Number(url.searchParams.get('limit')) || 200));
	return json(slideshow(getDb(), limit, url.searchParams.get('seed') ?? ''));
};
