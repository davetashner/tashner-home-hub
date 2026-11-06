import { error, json } from '@sveltejs/kit';
import { requireAdult } from '#lib/server/auth.js';
import { getDb } from '#lib/server/db/index.js';
import { readJson } from '#lib/server/api.js';
import { getNetwork, saveDevices, sweepNetwork } from '#lib/server/lan-monitor.js';
import type { RequestHandler } from './$types';

/** The home network's last sweep (NET-1). Adults only: it lists the household's devices. */
export const GET: RequestHandler = (event) => {
	requireAdult(event);
	return json(getNetwork(getDb()));
};

/** Replaces the device list (`{devices: [...]}`), then sweeps once so the page fills straight away. */
export const PUT: RequestHandler = async (event) => {
	requireAdult(event);
	const body = await readJson(event.request);
	if (!Array.isArray(body.devices)) error(400, 'Expected {devices: [...]}');
	const db = getDb();
	const kept = saveDevices(db, body.devices);
	void sweepNetwork(db).catch(() => undefined);
	return json({ devices: kept, dropped: body.devices.length - kept.length });
};
