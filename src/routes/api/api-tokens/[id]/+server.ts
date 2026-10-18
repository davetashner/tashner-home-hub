import { requireAdult } from '#lib/server/auth.js';
import { getDb } from '#lib/server/db/index.js';
import { revokeToken } from '#lib/server/domain/api-tokens.js';
import { handle } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** Revokes (deletes) a token; a Shortcut using it stops working at once. */
export const DELETE: RequestHandler = (event) => {
	requireAdult(event);
	return handle(() => revokeToken(getDb(), event.params.id));
};
