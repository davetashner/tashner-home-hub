import { json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { listFrameDrawings } from '#lib/server/domain/frame-drawings.js';
import type { RequestHandler } from './$types';

/** Posted drawings for the frame. Open to the LAN like the notes they come from: the wall display has no session. */
export const GET: RequestHandler = () => json(listFrameDrawings(getDb()));
