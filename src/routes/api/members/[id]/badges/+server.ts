import { getDb } from '#lib/server/db/index.js';
import { stickerBookFor } from '#lib/server/domain/badges.js';
import { handle } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** A child's sticker book. Query: `tz` (IANA zone, default household). */
export const GET: RequestHandler = ({ params, url }) =>
	handle(() =>
		stickerBookFor(getDb(), params.id, { timeZone: url.searchParams.get('tz') ?? undefined })
	);
