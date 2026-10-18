import type { Page } from '@playwright/test';
import {
	addTime,
	pauseTimer,
	resumeTimer,
	startTimer,
	type KitchenTimer
} from '../../src/lib/domain/timers';

/** In-memory stand-in for /api/timers, so a timer never fires in the shared database. */
export async function fakeTimerApi(page: Page, timers: KitchenTimer[]) {
	await page.route('**/api/timers**', async (route) => {
		const req = route.request();
		const id = new URL(req.url()).pathname.split('/')[3];
		const body = req.postDataJSON() ?? {};
		const now = Date.now();
		if (req.method() === 'POST') {
			timers.push(startTimer(body.id, body.durationMs, body.label, now));
		} else if (req.method() === 'PATCH') {
			const i = timers.findIndex((t) => t.id === id);
			const fn =
				body.action === 'pause' ? pauseTimer : body.action === 'resume' ? resumeTimer : null;
			timers[i] = fn ? fn(timers[i], now) : addTime(timers[i], body.ms, now);
		} else if (req.method() === 'DELETE') {
			timers.splice(
				timers.findIndex((t) => t.id === id),
				1
			);
		}
		await route.fulfill({ json: req.method() === 'GET' ? { now, timers } : {} });
	});
}
