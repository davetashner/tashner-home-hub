import { error, json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { readJson } from '#lib/server/api.js';
import { applyNotifyPatch, testMessage } from '#lib/domain/notify.js';
import {
	hasNotifyToken,
	readLastResult,
	readNotifyConfig,
	saveNotifyConfig,
	saveNotifyToken,
	sendNtfy
} from '#lib/server/notify.js';
import type { RequestHandler } from './$types';

function view() {
	const db = getDb();
	// The token is write-only: only whether one is saved goes back.
	return { ...readNotifyConfig(db), tokenSaved: hasNotifyToken(db), last: readLastResult(db) };
}

/** Adult only. Notification settings, the last send result, and whether a token is saved. */
export const GET: RequestHandler = (event) => {
	requireAdult(event);
	return json(view());
};

/** Adult only. Body: any of { enabled, serverUrl, topic, baseUrl, events, token }. `token: ""` forgets it. */
export const PUT: RequestHandler = async (event) => {
	requireAdult(event);
	const body = await readJson(event.request);
	const db = getDb();
	const next = applyNotifyPatch(readNotifyConfig(db), body);
	if (typeof next === 'string') error(400, next);
	if (body.token !== undefined && (typeof body.token !== 'string' || body.token.length > 500))
		error(400, 'token must be a string');
	saveNotifyConfig(db, next);
	if (typeof body.token === 'string') saveNotifyToken(db, body.token.trim());
	return json(view());
};

/** Adult only. Sends a test message with the saved settings and reports how it went. */
export const POST: RequestHandler = async (event) => {
	requireAdult(event);
	return json(await sendNtfy(getDb(), testMessage()));
};
