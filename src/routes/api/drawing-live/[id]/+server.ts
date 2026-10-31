import { snapshotSession } from '#lib/server/domain/drawing-live.js';
import { handle } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/**
 * Joins a session: `{ id, seq, items }`, the board so far. Subscribe to
 * `GET /api/events?topics=drawing` and apply entries with seq above this one; a gap means refetch.
 */
export const GET: RequestHandler = (event) => handle(() => snapshotSession(event.params.id));
