import { getDb } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { recentCompletions } from '#lib/server/domain/ledger.js';
import { handle } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

const DAY_MS = 86_400_000;

/** Adults: approved completions from the last `days` days (1-30, default 7), newest first. */
export const GET: RequestHandler = (event) => {
	requireAdult(event);
	const raw = Number(event.url.searchParams.get('days') ?? 7);
	const days = Number.isFinite(raw) ? Math.min(Math.max(Math.floor(raw), 1), 30) : 7;
	return handle(() => recentCompletions(getDb(), { since: Date.now() - days * DAY_MS }));
};
