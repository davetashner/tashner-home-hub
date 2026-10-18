import { json } from '@sveltejs/kit';
import { requireAdult } from '#lib/server/auth.js';
import {
	cancelImport,
	currentImport,
	isConnected
} from '#lib/server/photo-source/google-import.js';
import type { RequestHandler } from './$types';

/** Polled by the settings screen: whether Google is connected and how the current import is going. */
export const GET: RequestHandler = (event) => {
	requireAdult(event);
	return json({ connected: isConnected(), job: currentImport() });
};

export const DELETE: RequestHandler = (event) => {
	requireAdult(event);
	cancelImport();
	return json({ job: currentImport() });
};
