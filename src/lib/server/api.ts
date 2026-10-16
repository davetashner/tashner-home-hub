import { error, json } from '@sveltejs/kit';
import { LedgerError } from './domain/ledger.js';

const STATUS = { not_found: 404, forbidden: 403, conflict: 409, invalid: 400 } as const;

/** Runs a ledger operation, mapping LedgerError to an HTTP error. */
export function handle<T>(fn: () => T): Response {
	try {
		return json(fn());
	} catch (e) {
		if (e instanceof LedgerError) error(STATUS[e.code], e.message);
		throw e;
	}
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
	try {
		const body: unknown = await request.json();
		if (body && typeof body === 'object' && !Array.isArray(body))
			return body as Record<string, unknown>;
	} catch {
		// fall through
	}
	error(400, 'Expected a JSON object body');
}

export function str(v: unknown, name: string, optional = false): string {
	if (typeof v === 'string' && v.length > 0 && v.length <= 500) return v;
	if (optional && v === undefined) return '';
	error(400, `${name} must be a non-empty string`);
}

export function dateStr(v: unknown): string {
	if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
	error(400, 'date must be YYYY-MM-DD');
}

/** Local calendar day for `now` (server time zone is the household's). */
export function localDate(now: number): string {
	const d = new Date(now);
	const p = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
