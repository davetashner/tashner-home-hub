import { json } from '@sveltejs/kit';
import { requireAdult } from '#lib/server/auth.js';
import { exportAll } from '#lib/server/data-export.js';
import { exportFilename } from '#lib/server/domain/export.js';
import type { RequestHandler } from './$types';

/** Adult-only: download every app table as one JSON document (ADM-5). */
export const GET: RequestHandler = (event) => {
	requireAdult(event);
	const now = new Date();
	return json(exportAll(undefined, now), {
		headers: {
			'content-disposition': `attachment; filename=${exportFilename(now)}`,
			'cache-control': 'no-store'
		}
	});
};
