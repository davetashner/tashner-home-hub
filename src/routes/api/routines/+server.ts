import { getDb } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { createRoutine, listRoutines } from '#lib/server/domain/routines.js';
import { dateStr, handle, localDate, readJson } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** Query: `memberId` (default everyone), `date=YYYY-MM-DD` (default today) for each routine's progress. */
export const GET: RequestHandler = ({ url }) => {
	const raw = url.searchParams.get('date');
	const date = raw === null ? localDate(Date.now()) : dateStr(raw);
	return handle(() =>
		listRoutines(getDb(), { memberId: url.searchParams.get('memberId') ?? undefined, date })
	);
};

/** Body: { memberId, name, windowStart?, windowEnd?, steps: [{ label, icon }] }. */
export const POST: RequestHandler = async (event) => {
	requireAdult(event);
	const body = await readJson(event.request);
	const res = handle(() =>
		createRoutine(getDb(), {
			memberId: body.memberId as string,
			name: body.name,
			windowStart: body.windowStart,
			windowEnd: body.windowEnd,
			steps: body.steps
		})
	);
	return new Response(res.body, { status: 201, headers: res.headers });
};
