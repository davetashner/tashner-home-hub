import { json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { syncStatus } from '#lib/server/calendar/read.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => json(syncStatus(getDb()));
