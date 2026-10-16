import { error, json } from '@sveltejs/kit';
import { requireAdult } from '#lib/server/auth.js';
import { readJson } from '#lib/server/api.js';
import { displayOrientation, parseRotationBody } from '#lib/domain/orientation.js';
import { readRotation, writeRotation } from '#lib/server/display.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => json(displayOrientation(readRotation()));

/** Adult only. Body: { rotation: "normal" | "90" | "180" | "270" } (a wlr-randr transform). */
export const PUT: RequestHandler = async (event) => {
	requireAdult(event);
	const rotation = parseRotationBody(await readJson(event.request));
	if (typeof rotation !== 'string') error(400, rotation.error);
	writeRotation(rotation);
	return json(displayOrientation(readRotation()));
};
