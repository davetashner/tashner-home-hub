import { error, redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { getDb } from '#lib/server/db/index.js';
import { serverTheme } from '#lib/server/appearance.js';
import { startBackupScheduler } from '#lib/server/backup.js';
import { resolveAdult } from '#lib/server/auth.js';
import { startPhotoScanner } from '#lib/server/photo-source/scheduler.js';
import { startCalendarScheduler } from '#lib/server/calendar/scheduler.js';
import { startMissedScheduler } from '#lib/server/missed-scheduler.js';
import { startSitterScheduler } from '#lib/server/sitter-scheduler.js';
import { startMotionWake } from '#lib/server/home-assistant/motion.js';
import { startWeatherScheduler } from '#lib/server/weather.js';
// Side-effect imports register the real calendar providers before the first scheduled sync.
import '#lib/server/calendar/ics.js';
import '#lib/server/calendar/google.js';
import '#lib/server/calendar/icloud.js';
import { installShutdownHandlers, trackJob } from '#lib/server/shutdown.js';
import { readDisplayParam } from '#lib/domain/display-role.js';
import { setDisplayRole } from '#lib/server/display-role.js';
import { isRequestAllowed } from '#lib/server/domain/network.js';

const allowPublic = process.env.HUB_ALLOW_PUBLIC === 'true';
const allowTailscale = process.env.HUB_ALLOW_TAILSCALE === 'true';

/** LAN-only by default (NFR-3): refuse non-private source addresses unless HUB_ALLOW_PUBLIC=true.
 * HUB_ALLOW_TAILSCALE=true also admits 100.64.0.0/10. getClientAddress() already applies XFF_DEPTH, so
 * both rules see the same resolved client IP. */
export const handle: Handle = async ({ event, resolve }) => {
	let clientAddress: string | undefined;
	try {
		clientAddress = event.getClientAddress();
	} catch {
		clientAddress = undefined;
	}
	if (!isRequestAllowed(clientAddress, { allowPublic, allowTailscale })) {
		error(403, 'Forbidden: this hub only accepts connections from the local network');
	}
	// `?display=wall` (the Pi kiosk's launch URL) sets this device's role, then drops the query.
	const display = readDisplayParam(event.url);
	if (display && event.request.method === 'GET') {
		setDisplayRole(event, display.role);
		redirect(303, display.location);
	}
	event.locals.adult = resolveAdult(event);
	// Render the right theme on the first paint, so a reload at night never flashes light.
	const theme = serverTheme();
	return resolve(event, {
		transformPageChunk: ({ html }) =>
			html.replace('<html lang="en">', `<html lang="en" data-theme="${theme}">`)
	});
};

/** Opens the database and applies pending migrations once, at server startup. */
export function init(): void {
	getDb();
	installShutdownHandlers();
	trackJob(startBackupScheduler());
	trackJob(startCalendarScheduler());
	trackJob(startWeatherScheduler());
	trackJob(startMissedScheduler());
	trackJob(startSitterScheduler());
	trackJob(startPhotoScanner());
	trackJob(startMotionWake());
}
