import { getDb } from '#lib/server/db/index.js';
import { streakSummary } from '#lib/server/domain/streaks.js';
import { handle } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** A child's current streak and next milestone. Query: `tz` (IANA zone, default household). */
export const GET: RequestHandler = ({ params, url }) =>
	handle(() =>
		streakSummary(getDb(), params.id, { timeZone: url.searchParams.get('tz') ?? undefined })
	);
