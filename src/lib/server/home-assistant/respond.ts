import { error } from '@sveltejs/kit';
import { HaError } from './index.js';

/** Runs an HA operation, mapping HaError to an HTTP error the pages can show. */
export async function haRoute<T>(fn: () => Promise<T> | T): Promise<T> {
	try {
		return await fn();
	} catch (e) {
		if (e instanceof HaError)
			error(e.kind === 'invalid' ? 400 : e.kind === 'rejected' ? 401 : 502, e.message);
		throw e;
	}
}
