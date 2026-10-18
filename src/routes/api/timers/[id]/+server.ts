import { getDb } from '#lib/server/db/index.js';
import { deleteTimer, updateTimer } from '#lib/server/domain/timers.js';
import { handle, readJson } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** Body: { action: 'pause' | 'resume' | 'add', ms? } (ms only for add). */
export const PATCH: RequestHandler = async ({ params, request }) => {
	const body = await readJson(request);
	return handle(() => updateTimer(getDb(), params.id, body.action, body.ms));
};

/** Dismiss a finished timer or cancel a running one. Send a JSON content-type (body `{}`). */
export const DELETE: RequestHandler = ({ params }) => handle(() => deleteTimer(getDb(), params.id));
