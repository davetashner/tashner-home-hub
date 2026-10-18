import { json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { getKeyring } from '#lib/server/keys.js';
import { currentSession, readCard, toView } from '#lib/server/domain/sitter.js';
import type { RequestHandler } from './$types';

/**
 * For the wall: { session, card }. `session` is the active session, else the next scheduled one,
 * else null. `card` is only filled while a session is active and has no PIN; with a PIN the wall
 * asks POST /api/sitter/check instead. Open to every caller on the LAN, like the other wall reads.
 */
export const GET: RequestHandler = () => {
	const now = Date.now();
	const row = currentSession(getDb(), now);
	const session = row ? toView(row, now) : null;
	const open = session?.status === 'active' && !session.hasPin;
	return json({ session, card: open ? readCard(getDb(), getKeyring()) : null });
};
