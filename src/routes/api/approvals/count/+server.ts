import { getDb } from '#lib/server/db/index.js';
import { handle } from '#lib/server/api.js';
import { attentionCount } from '#lib/server/domain/attention.js';
import type { RequestHandler } from './$types';

/** Open on purpose: bare counts (no names, no chores) for the wall badge. */
export const GET: RequestHandler = () => handle(() => attentionCount(getDb()));
