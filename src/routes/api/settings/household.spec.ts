import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, expect, it } from 'vitest';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'hub-household-api-'));
const savedTz = process.env.TZ;
process.env.TZ = 'America/Chicago';
afterEach(() => {
	process.env.TZ = 'America/Chicago';
});
afterAll(() => {
	if (savedTz === undefined) delete process.env.TZ;
	else process.env.TZ = savedTz;
});

const { getDb, schema } = await import('#lib/server/db/index.js');
const household = await import('./household/+server.js');
const get = () => (household.GET as unknown as () => Response)().json();
const put = (body: unknown, adult = true) =>
	(household.PUT as unknown as (e: unknown) => Promise<Response>)({
		locals: { adult: adult ? { id: 'adult', name: 'Test Adult' } : null },
		cookies: { get: () => undefined },
		request: new Request('http://example.com/x', { method: 'PUT', body: JSON.stringify(body) })
	});

it('defaults to the TZ environment variable', async () => {
	expect(await get()).toEqual({ timeZone: 'America/Chicago' });
	process.env.TZ = ':Europe/Paris';
	expect(await get()).toEqual({ timeZone: 'Europe/Paris' });
});

it('ignores corrupt or unknown stored values', async () => {
	const db = getDb();
	db.insert(schema.settings).values({ key: 'household.timeZone', value: '{oops' }).run();
	expect(await get()).toEqual({ timeZone: 'America/Chicago' });
	db.update(schema.settings).set({ value: '"Mars/Olympus"' }).run();
	expect(await get()).toEqual({ timeZone: 'America/Chicago' });
});

it('lets a grown-up pick a zone, stored in its canonical spelling', async () => {
	expect(await (await put({ timeZone: 'europe/london' })).json()).toEqual({
		timeZone: 'Europe/London'
	});
	expect(await get()).toEqual({ timeZone: 'Europe/London' });
});

it('rejects anything that is not an IANA zone without writing', async () => {
	for (const timeZone of ['Mars/Olympus', '+05:00', '', 42, undefined])
		await expect(put({ timeZone })).rejects.toMatchObject({ status: 400 });
	expect(await get()).toEqual({ timeZone: 'Europe/London' });
});

it('needs an adult to change it', async () => {
	await expect(put({ timeZone: 'UTC' }, false)).rejects.toMatchObject({ status: 401 });
});
