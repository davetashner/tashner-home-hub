import { json } from '@sveltejs/kit';
import { getMusicConfig } from '#lib/server/music/index.js';
import type { RequestHandler } from './$types';

/** The parent-approved playlists: all kids may read them. */
export const GET: RequestHandler = () => json(getMusicConfig().playlists);
