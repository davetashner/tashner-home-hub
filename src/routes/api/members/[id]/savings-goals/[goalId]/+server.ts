import { getDb } from '#lib/server/db/index.js';
import { archiveSavingsGoal, updateSavingsGoal } from '#lib/server/domain/savings-goals.js';
import { handle, readJson } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** Body: any of { title, emoji, targetCents }. Open to kids (no PIN), like creating a goal. */
export const PATCH: RequestHandler = async (event) => {
	const body = await readJson(event.request);
	return handle(() => updateSavingsGoal(getDb(), event.params.id, event.params.goalId, body));
};

/** Archives the goal (send a JSON content-type with body `{}`). Open to kids (no PIN). */
export const DELETE: RequestHandler = ({ params }) =>
	handle(() => archiveSavingsGoal(getDb(), params.id, params.goalId));
