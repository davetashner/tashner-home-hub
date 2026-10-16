import { randomBytes, randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '#lib/server/db/index.js';
import { calendarSources } from '#lib/server/db/schema.js';

process.env.HUB_SECRET_KEY = randomBytes(32).toString('base64');

let db: Db;
vi.mock('#lib/server/db/index.js', async (orig) => ({
	...(await orig<typeof import('#lib/server/db/index.js')>()),
	getDb: () => db
}));
const probe = vi.fn();
vi.mock('#lib/server/calendar/icloud.js', async (orig) => ({
	...(await orig<typeof import('#lib/server/calendar/icloud.js')>()),
	probeIcloud: (...a: unknown[]) => probe(...a)
}));

const one = await import('./sources/[id]/+server.js');
const { IcloudError, REAUTH_MESSAGE, openCredentials, sealCredentials } =
	await import('#lib/server/calendar/icloud.js');
const { getKeyring } = await import('#lib/server/keys.js');

const adult = { adult: { id: 'a', name: 'A' } };
const patch = (id: string, body: unknown, locals: unknown = adult) =>
	one.PATCH({
		locals,
		params: { id },
		request: new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) })
	} as never);
const outcome = async (f: () => unknown) => {
	try {
		await f();
	} catch (e) {
		return e as { status: number; body: { message: string } };
	}
};

describe('PATCH new iCloud password (re-auth)', () => {
	let id: string;
	beforeEach(() => {
		db = openDb(':memory:');
		probe.mockReset();
		id = randomUUID();
		db.insert(calendarSources)
			.values({
				id,
				provider: 'icloud',
				label: 'Apple',
				credentials: sealCredentials(getKeyring(), id, {
					appleId: 'jane@example.com',
					appPassword: 'old-old-old-old'
				}),
				calendars: '[]'
			})
			.run();
	});

	it('probes, then stores the new password and keeps the Apple ID', async () => {
		probe.mockResolvedValue([{ externalId: 'x', name: 'Home' }]);
		const res = await patch(id, { appPassword: ' new-new-new-new ' });
		expect(res.status).toBe(200);
		expect(JSON.stringify(await res.json())).not.toContain('new-new');
		const row = db.select().from(calendarSources).get()!;
		expect(openCredentials(getKeyring(), row)).toEqual({
			appleId: 'jane@example.com',
			appPassword: 'new-new-new-new'
		});
	});

	it('surfaces Apple rejecting the password as 401 and stores nothing', async () => {
		probe.mockRejectedValue(new IcloudError(REAUTH_MESSAGE, true));
		const before = db.select().from(calendarSources).get()!.credentials;
		const e = await outcome(() => patch(id, { appPassword: 'bad' }));
		expect(e?.status).toBe(401);
		expect(db.select().from(calendarSources).get()!.credentials).toBe(before);
	});

	it('is adult-only and iCloud-only', async () => {
		expect((await outcome(() => patch(id, { appPassword: 'x' }, {})))?.status).toBe(401);
		const gid = randomUUID();
		db.insert(calendarSources)
			.values({ id: gid, provider: 'google', label: 'G', calendars: '[]' })
			.run();
		expect((await outcome(() => patch(gid, { appPassword: 'x' })))?.status).toBe(400);
	});
});
