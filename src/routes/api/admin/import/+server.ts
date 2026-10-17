import { error, json } from '@sveltejs/kit';
import { requireAdult } from '#lib/server/auth.js';
import { importAll } from '#lib/server/data-export.js';
import type { RequestHandler } from './$types';

/** Adult-only: replace all app data with an export document (a backup is taken first). */
export const POST: RequestHandler = async (event) => {
	requireAdult(event);
	let body: unknown;
	try {
		body = await event.request.json();
	} catch {
		error(400, 'The file is not valid JSON.');
	}
	const result = await importAll(body);
	if (!result.ok) return json({ error: result.error }, { status: result.status });
	return json(result);
};
