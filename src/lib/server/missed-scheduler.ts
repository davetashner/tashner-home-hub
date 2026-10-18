import { Cron } from 'croner';
import { getDb } from './db/index.js';
import { judgeMissedPeriods } from './domain/missed.js';

/**
 * Judges ended job periods once at startup (catching up after downtime) and then every 10 minutes.
 * Periods are recorded as judged, so repeated runs are free and never deduct twice.
 */
export function startMissedScheduler(): Cron {
	const tick = () => {
		try {
			judgeMissedPeriods(getDb());
		} catch (e) {
			console.error('[missed-jobs] judging failed:', e);
		}
	};
	tick();
	return new Cron('*/10 * * * *', { protect: true, catch: true }, tick);
}
