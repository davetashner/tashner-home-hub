import { Cron } from 'croner';
import { getDb } from './db/index.js';
import { sweepSitterNotices } from './notify.js';

/** Every minute: tells the parents a sitter session began, or ended on its own (hub-7pj.3). */
export function startSitterScheduler(): Cron {
	return new Cron('* * * * *', { protect: true, catch: true }, () => sweepSitterNotices(getDb()));
}
