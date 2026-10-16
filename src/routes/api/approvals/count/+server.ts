import { count, eq } from 'drizzle-orm';
import { getDb, schema } from '#lib/server/db/index.js';
import { handle } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** Open on purpose: a bare count (no names, no chores) for the wall badge. */
export const GET: RequestHandler = () =>
	handle(() => ({
		pending:
			getDb()
				.select({ n: count() })
				.from(schema.choreCompletions)
				.where(eq(schema.choreCompletions.status, 'pending'))
				.get()?.n ?? 0
	}));
