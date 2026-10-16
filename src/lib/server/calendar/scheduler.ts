import { Cron } from 'croner';
import { getDb } from '../db/index.js';
import { runSync } from './sync.js';

/** Every 5 minutes (CAL-7). `HUB_CALENDAR_SYNC=off` disables it. Croner's `protect` skips overlapping ticks. */
export function startCalendarScheduler(env: NodeJS.ProcessEnv = process.env): Cron | undefined {
	if (env.HUB_CALENDAR_SYNC === 'off') return undefined;
	const tick = () => void runSync(getDb()).catch(() => undefined);
	tick();
	return new Cron('*/5 * * * *', { protect: true, catch: true }, tick);
}
