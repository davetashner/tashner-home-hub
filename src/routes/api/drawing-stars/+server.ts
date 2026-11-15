import { getDb } from '#lib/server/db/index.js';
import { awardDrawingStar, drawingStarSummary } from '#lib/server/domain/drawing-stars.js';
import { handle, readJson } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** { enabled, date, streaks: { [childId]: { streak, earned } } }. Open to every device. */
export const GET: RequestHandler = () => handle(() => drawingStarSummary(getDb()));

/**
 * Body: { memberId }. Sent when a drawing made from the shown daily prompt is posted. The server
 * decides: one star per child per household day, nothing when stars are off. No PIN: kids post.
 */
export const POST: RequestHandler = async (event) => {
	const body = await readJson(event.request);
	return handle(() => awardDrawingStar(getDb(), body.memberId));
};
