import { getDb } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import {
	activitiesForMember,
	createPracticeActivity,
	listPracticeActivities
} from '#lib/server/domain/practice-activities.js';
import { handle, readJson } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/**
 * `?memberId=` lists the active activities that apply to that member (the kid screen, no
 * sign-in needed). Without it, every activity including inactive ones: grown-ups only.
 */
export const GET: RequestHandler = (event) => {
	const memberId = event.url.searchParams.get('memberId');
	if (memberId) return handle(() => activitiesForMember(getDb(), memberId));
	requireAdult(event);
	return handle(() => listPracticeActivities(getDb()));
};

/** Body: { name, emoji?, minutesPerBlock, starsPerBlock, dailyStarCap, memberIds? (null = all kids), active?, sortOrder? }. */
export const POST: RequestHandler = async (event) => {
	requireAdult(event);
	const b = await readJson(event.request);
	const res = handle(() =>
		createPracticeActivity(getDb(), {
			name: b.name as string,
			emoji: b.emoji as string | null | undefined,
			minutesPerBlock: b.minutesPerBlock as number,
			starsPerBlock: b.starsPerBlock as number,
			dailyStarCap: b.dailyStarCap as number,
			memberIds: b.memberIds as string[] | null | undefined,
			active: b.active as boolean | undefined,
			sortOrder: b.sortOrder as number | undefined
		})
	);
	return new Response(res.body, { status: 201, headers: res.headers });
};
