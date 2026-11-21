import { error, json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { readJson } from '#lib/server/api.js';
import {
	LightError,
	changeLight,
	forgetLight,
	renameLight,
	udpExchange
} from '#lib/server/lights.js';
import { cleanName, isDimming, normMac, type BulbChange } from '#lib/domain/wiz.js';
import type { RequestHandler } from './$types';

const STATUS = { not_found: 404, unreachable: 502 } as const;

function macOf(param: string): string {
	const mac = normMac(param);
	if (!mac) error(400, 'Not a MAC address');
	return mac;
}

/** Adult only. Body: { on?: boolean, dimming?: 10..100, name?: string }. */
export const PATCH: RequestHandler = async (event) => {
	requireAdult(event);
	const mac = macOf(event.params.mac);
	const body = await readJson(event.request);
	if (body.on !== undefined && typeof body.on !== 'boolean') error(400, 'on must be true or false');
	if (body.dimming !== undefined && !isDimming(body.dimming))
		error(400, 'dimming must be a whole number from 10 to 100');
	const name = body.name === undefined ? undefined : cleanName(body.name);
	if (name === null) error(400, 'name must be 1 to 40 characters');
	const change: BulbChange = {
		on: body.on as boolean | undefined,
		dimming: body.dimming as number | undefined
	};
	try {
		const db = getDb();
		if (name) renameLight(db, mac, name);
		if (change.on !== undefined || change.dimming !== undefined)
			await changeLight(db, mac, change, udpExchange());
	} catch (e) {
		if (e instanceof LightError) error(STATUS[e.code], e.message);
		throw e;
	}
	return json({ ok: true });
};

/** Adult only. Forgets a bulb (a later search finds it again). */
export const DELETE: RequestHandler = (event) => {
	requireAdult(event);
	forgetLight(getDb(), macOf(event.params.mac));
	return json({ ok: true });
};
