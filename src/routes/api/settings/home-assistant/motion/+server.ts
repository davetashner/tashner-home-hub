import { json } from '@sveltejs/kit';
import { requireAdult } from '#lib/server/auth.js';
import { readJson } from '#lib/server/api.js';
import {
	listMotionSensors,
	readMotionSensor,
	saveMotionSensor
} from '#lib/server/home-assistant/index.js';
import { haRoute } from '#lib/server/home-assistant/respond.js';
import type { RequestHandler } from './$types';

/** Adult only. The binary sensors Home Assistant offers for waking the wall, and the saved pick. */
export const GET: RequestHandler = async (event) => {
	requireAdult(event);
	return json({
		sensors: await haRoute(() => listMotionSensors()),
		selected: readMotionSensor()
	});
};

/** Adult only. Body: { entityId: "binary_sensor.x" | null }. null (None) stops polling. */
export const PUT: RequestHandler = async (event) => {
	requireAdult(event);
	const body = await readJson(event.request);
	return json({ selected: await haRoute(() => saveMotionSensor(body.entityId ?? null)) });
};
