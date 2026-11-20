import { getDb } from '#lib/server/db/index.js';
import { maintenanceDueCount } from '#lib/server/domain/maintenance.js';
import { handle, localDate } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** { due }: tasks due today or overdue, for the badge on the Lists menu item. Cheap. */
export const GET: RequestHandler = () =>
	handle(() => ({ due: maintenanceDueCount(getDb(), localDate(Date.now())) }));
