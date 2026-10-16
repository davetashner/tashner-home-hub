import { json } from '@sveltejs/kit';
import { requireAdult } from '#lib/server/auth.js';
import { backupStatus, runBackup } from '#lib/server/backup.js';
import type { RequestHandler } from './$types';

/** Adult-only: backup list and last result. */
export const GET: RequestHandler = (event) => {
	requireAdult(event);
	return json(backupStatus());
};

/** Adult-only: run a backup now. */
export const POST: RequestHandler = async (event) => {
	requireAdult(event);
	const result = await runBackup();
	return json(result, { status: result.ok ? 200 : 500 });
};
