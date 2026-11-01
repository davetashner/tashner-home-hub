import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'hub-sports-api-'));

const { getDb } = await import('#lib/server/db/index.js');
const sp = await import('#lib/server/sports.js');
const { subscribe } = await import('#lib/server/domain/events.js');
const settingsRoute = await import('../settings/sports/+server.js');
const sportsRoute = await import('./+server.js');

const NOW = Date.parse('2026-11-08T12:00:00Z');
const comp = (id: string, date: string, state: string, abbr: string, opp: string) => ({
	id,
	competitions: [
		{
			date,
			competitors: [
				{ homeAway: 'home', team: { abbreviation: abbr, displayName: abbr }, score: '3' },
				{ homeAway: 'away', team: { abbreviation: opp, displayName: opp }, score: '1' }
			],
			broadcasts: [{ names: ['NBC'] }],
			status: { period: 1, displayClock: '5:00', type: { name: 'X', state } }
		}
	]
});
const body = (...events: unknown[]) => new Response(JSON.stringify({ events }));
/** Routes ESPN urls to canned bodies; `fail` makes every call reject. */
function espn(state = 'pre', fail = false) {
	return vi.fn(async (url: string) => {
		if (fail) throw new Error('offline');
		if (url.includes('/nfl/teams/bal/'))
			return body(comp('g1', '2026-11-10T18:00Z', 'pre', 'BAL', 'CIN'));
		if (url.includes('/teams/wsh/')) return body();
		if (url.includes('/nfl/scoreboard'))
			return body(comp('g1', '2026-11-10T18:00Z', state, 'BAL', 'CIN'));
		return body();
	});
}
const event = (adult: boolean, extra: object = {}) => ({
	locals: { adult: adult ? { id: 'a', name: 'Test Adult' } : null },
	cookies: { get: () => undefined },
	...extra
});
const call = (fn: unknown, e: unknown) => (fn as (e: unknown) => unknown)(e);

it('defaults to the three family teams', async () => {
	const res = (await (call(settingsRoute.GET, {}) as Response).json()) as {
		teams: { id: string }[];
	};
	expect(res.teams.map((t) => t.id)).toEqual(['nfl:bal', 'nfl:wsh', 'nhl:wsh']);
});

it('refreshes, publishes only on change, and keeps data when offline', async () => {
	const db = getDb();
	sp.resetSportsState();
	const seen: string[] = [];
	const off = subscribe(['sports'], (e) => seen.push(e.topic))!;
	const f = espn();
	expect(await sp.refreshSports(db, f, NOW)).toBe(true);
	expect(f.mock.calls.map((c) => c[0])).toEqual(
		expect.arrayContaining([
			'https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/bal/schedule',
			'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams/wsh/schedule',
			'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard'
		])
	);
	expect(seen).toEqual(['sports']);
	const view = sp.getSports(db, f, NOW);
	expect(view.games).toHaveLength(1);
	expect(view.games[0]).toMatchObject({ team: 'nfl:bal', status: 'scheduled', channel: 'NBC' });

	// unchanged: schedules are not refetched within the hour, no publish
	const calls = f.mock.calls.length;
	expect(await sp.refreshSports(db, f, NOW + 60_000)).toBe(false);
	expect(f.mock.calls.length - calls).toBe(2); // scoreboards only
	expect(seen).toHaveLength(1);

	// live score overlays the schedule and publishes
	expect(await sp.refreshSports(db, espn('in'), NOW + 120_000)).toBe(true);
	expect(sp.getSports(db, f, NOW).games[0]).toMatchObject({ status: 'live', teamScore: 3 });
	expect(seen).toHaveLength(2);

	// offline and bad shapes keep the last good snapshot
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
	const down = espn('pre', true);
	expect(await sp.refreshSports(db, down, NOW + 7_200_000)).toBe(false);
	expect(await sp.refreshSports(db, down, NOW + 7_300_000)).toBe(false);
	expect(warn).toHaveBeenCalledTimes(1);
	const junk = vi.fn(async () => new Response('nope', { status: 500 }));
	expect(await sp.refreshSports(db, junk, NOW + 7_400_000)).toBe(false);
	const shape = vi.fn(async () => new Response(JSON.stringify({ unexpected: true })));
	await sp.refreshSports(db, shape, NOW + 7_500_000);
	expect(sp.getSports(db, down, NOW + 3_000).games[0]).toMatchObject({ status: 'live' });
	warn.mockRestore();
	off();
});

it('serves the cache without touching the network', () => {
	const f = espn();
	const view = sp.getSports(getDb(), f, NOW);
	expect(view.updatedAt).not.toBeNull();
	expect(f).not.toHaveBeenCalled();
});

it('ticks on the cadence the games imply', async () => {
	const db = getDb();
	sp.resetSportsState();
	const f = espn('in');
	expect(await sp.sportsTick(db, f, NOW)).toBe(true); // cached game is live: fast cadence
	expect(await sp.sportsTick(db, f, NOW + 20_000)).toBe(false);
	expect(await sp.sportsTick(db, f, NOW + 46_000)).toBe(true);
	expect(sp.startSportsScheduler({ HUB_SPORTS: 'off' } as NodeJS.ProcessEnv)).toBeUndefined();
	expect(
		sp.startSportsScheduler({ E2E_DATA_DIR: '/tmp/e2e' } as NodeJS.ProcessEnv)
	).toBeUndefined();
	const job = sp.startSportsScheduler({} as NodeJS.ProcessEnv);
	expect(job).toBeDefined();
	job?.stop();
});

it('fetches in the background when no cache exists yet', async () => {
	const { settings } = await import('#lib/server/db/schema.js');
	const { eq } = await import('drizzle-orm');
	const db = getDb();
	db.delete(settings).where(eq(settings.key, 'sports.cache')).run();
	sp.resetSportsState();
	const f = espn();
	expect(sp.getSports(db, f, NOW)).toMatchObject({ games: [], updatedAt: null });
	sp.getSports(db, f, NOW); // joins the in-flight refresh
	await vi.waitFor(() => expect(sp.getSports(db, f, NOW).games).toHaveLength(1));
	// first-ever fetch failing is survivable too
	db.delete(settings).where(eq(settings.key, 'sports.cache')).run();
	sp.resetSportsState();
	vi.spyOn(console, 'warn').mockImplementation(() => undefined);
	sp.getSports(db, espn('pre', true), NOW);
	await vi.waitFor(() => expect(sp.getSports(db, f, NOW).updatedAt).not.toBeNull());
});

it('never calls ESPN under the e2e harness or when switched off', async () => {
	const { settings } = await import('#lib/server/db/schema.js');
	const { eq } = await import('drizzle-orm');
	const db = getDb();
	db.delete(settings).where(eq(settings.key, 'sports.cache')).run();
	sp.resetSportsState();
	const f = vi.fn(espn());
	for (const env of [{ E2E_DATA_DIR: '/tmp/e2e' }, { HUB_SPORTS: 'off' }]) {
		expect(sp.getSports(db, f, NOW, env as NodeJS.ProcessEnv)).toMatchObject({ games: [] });
	}
	expect(f).not.toHaveBeenCalled();
});

it('requires an adult to change teams and validates the list', async () => {
	const put = (b: unknown, adult = true) =>
		call(
			settingsRoute.PUT,
			event(adult, {
				request: new Request('http://x/', { method: 'PUT', body: JSON.stringify(b) })
			})
		) as Promise<Response>;
	await expect(put({ teams: [{ league: 'nhl', abbr: 'WSH' }] }, false)).rejects.toMatchObject({
		status: 401
	});
	await expect(put({ teams: [] })).rejects.toMatchObject({ status: 400 });
	await expect(put(null)).rejects.toMatchObject({ status: 400 });
	await expect(
		call(
			settingsRoute.PUT,
			event(true, { request: new Request('http://x/', { method: 'PUT', body: '{' }) })
		) as Promise<Response>
	).rejects.toMatchObject({ status: 400 });
	const res = await put({ teams: [{ league: 'nhl', abbr: 'wsh', name: 'Capitals' }] });
	expect(((await res.json()) as { teams: unknown[] }).teams).toHaveLength(1);
	const got = (await (call(settingsRoute.GET, {}) as Response).json()) as {
		teams: { id: string }[];
	};
	expect(got.teams.map((t) => t.id)).toEqual(['nhl:wsh']);
	const view = (await (call(sportsRoute.GET, {}) as Response).json()) as { games: unknown[] };
	expect(view.games).toEqual([]); // the cached Ravens game is filtered out
});
