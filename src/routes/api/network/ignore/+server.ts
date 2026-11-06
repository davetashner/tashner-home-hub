import { error, json } from '@sveltejs/kit';
import { requireAdult } from '#lib/server/auth.js';
import { getDb } from '#lib/server/db/index.js';
import { readJson } from '#lib/server/api.js';
import { ignoreHost } from '#lib/server/lan-monitor.js';
import { isPrivateIp } from '#lib/domain/lan-monitor.js';
import type { RequestHandler } from './$types';

/** Stops showing a host under "New on the network" (NET-4). */
export const POST: RequestHandler = async (event) => {
	requireAdult(event);
	const { ip } = await readJson(event.request);
	if (typeof ip !== 'string' || !isPrivateIp(ip)) error(400, 'Expected {ip} on the home network');
	ignoreHost(getDb(), ip);
	return json({ ok: true });
};
