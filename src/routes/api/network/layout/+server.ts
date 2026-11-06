import { error, json } from '@sveltejs/kit';
import { requireAdult } from '#lib/server/auth.js';
import { getDb } from '#lib/server/db/index.js';
import { readJson } from '#lib/server/api.js';
import { saveLayout } from '#lib/server/lan-monitor.js';
import type { RequestHandler } from './$types';

/** Replaces the house floor plan (NET-3). Accepts the plan builder's export as-is. */
export const PUT: RequestHandler = async (event) => {
	requireAdult(event);
	const layout = saveLayout(getDb(), await readJson(event.request));
	if (!layout) error(400, 'Expected a floor plan: {rooms: [...], placements: [...]}');
	return json(layout);
};
