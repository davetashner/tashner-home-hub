import { json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { getSports } from '#lib/server/sports.js';
import type { RequestHandler } from './$types';

/** Followed teams' games: yesterday's finals through the next 14 days. Cache only, never slow. */
export const GET: RequestHandler = () => json(getSports(getDb()));
