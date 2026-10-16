import { error, json, type RequestEvent } from '@sveltejs/kit';
import { MemberError } from '#lib/server/domain/members.js';

/** Maps domain errors to HTTP errors; rethrows anything else. */
export function handle<T>(fn: () => T): T {
	try {
		return fn();
	} catch (e) {
		if (e instanceof MemberError) {
			const status = { validation: 400, not_found: 404, last_adult: 409, confirm_required: 409 }[
				e.code
			];
			error(status, e.message);
		}
		throw e;
	}
}

export async function body(event: RequestEvent): Promise<Record<string, unknown>> {
	const data: unknown = await event.request.json().catch(() => null);
	if (typeof data !== 'object' || data === null || Array.isArray(data)) {
		error(400, 'Expected a JSON object.');
	}
	return data as Record<string, unknown>;
}

export { json };
