import { error } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { getDb } from '#lib/server/db/index.js';
import { isRequestAllowed } from '#lib/server/domain/network.js';

const allowPublic = process.env.HUB_ALLOW_PUBLIC === 'true';

/** LAN-only by default (NFR-3): refuse non-private source addresses unless HUB_ALLOW_PUBLIC=true. */
export const handle: Handle = async ({ event, resolve }) => {
	let clientAddress: string | undefined;
	try {
		clientAddress = event.getClientAddress();
	} catch {
		clientAddress = undefined;
	}
	if (!isRequestAllowed(clientAddress, { allowPublic })) {
		error(403, 'Forbidden: this hub only accepts connections from the local network');
	}
	return resolve(event);
};

/** Opens the database and applies pending migrations once, at server startup. */
export function init(): void {
	getDb();
}
