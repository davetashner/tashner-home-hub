import { json } from '@sveltejs/kit';
import { readTiles } from '#lib/server/home-assistant/index.js';
import type { RequestHandler } from './$types';

/** The Home card's tiles with live state. `{ configured: false }` hides the card. */
export const GET: RequestHandler = async () =>
	json(await readTiles(), { headers: { 'cache-control': 'no-store' } });
