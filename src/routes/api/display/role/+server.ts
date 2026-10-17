import { error, json } from '@sveltejs/kit';
import { requireAdult } from '#lib/server/auth.js';
import { readJson } from '#lib/server/api.js';
import { isDisplayRole } from '#lib/domain/display-role.js';
import { displayRole, setDisplayRole } from '#lib/server/display-role.js';
import type { RequestHandler } from './$types';

/** This browser's own role (DEV-1). */
export const GET: RequestHandler = (event) =>
	json({ role: displayRole(event) }, { headers: { 'cache-control': 'no-store' } });

/** Adult only. Body: { role: 'wall' | 'personal' }. Sets the device cookie on the calling browser. */
export const PUT: RequestHandler = async (event) => {
	requireAdult(event);
	const body = await readJson(event.request);
	if (!isDisplayRole(body.role)) error(400, "role must be 'wall' or 'personal'");
	setDisplayRole(event, body.role);
	return json({ role: body.role });
};
