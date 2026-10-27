import { getDb } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { updatePracticeActivity } from '#lib/server/domain/practice-activities.js';
import { handle, readJson } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** Body: any of the POST fields. Deactivate with { active: false }; activities are never deleted. */
export const PATCH: RequestHandler = async (event) => {
	requireAdult(event);
	const b = await readJson(event.request);
	return handle(() =>
		updatePracticeActivity(getDb(), event.params.id, {
			name: b.name as string | undefined,
			emoji: b.emoji as string | null | undefined,
			minutesPerBlock: b.minutesPerBlock as number | undefined,
			starsPerBlock: b.starsPerBlock as number | undefined,
			dailyStarCap: b.dailyStarCap as number | undefined,
			memberIds: b.memberIds as string[] | null | undefined,
			active: b.active as boolean | undefined,
			sortOrder: b.sortOrder as number | undefined
		})
	);
};
