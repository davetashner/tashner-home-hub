import { error, json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { readSportsTeams, saveSportsTeams } from '#lib/server/sports.js';
import type { RequestHandler } from './$types';

/** The followed teams (the family defaults until changed). */
export const GET: RequestHandler = () => json({ teams: readSportsTeams(getDb()) });

/** Adult only. Body: { teams: [{ league: "nfl" | "nhl", abbr: "BAL", name?: "Ravens" }] }. */
export const PUT: RequestHandler = async (event) => {
	requireAdult(event);
	let body: unknown;
	try {
		body = await event.request.json();
	} catch {
		error(400, 'Expected a JSON body');
	}
	const raw = body && typeof body === 'object' ? (body as { teams?: unknown }).teams : undefined;
	const teams = saveSportsTeams(getDb(), raw);
	if (!teams) error(400, 'teams must list at least one { league: "nfl" | "nhl", abbr }');
	return json({ teams });
};
