import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'hub-frame-overlay-api-'));

const { getDb, schema } = await import('#lib/server/db/index.js');
const overlay = await import('./frame-overlay/+server.js');
const get = () => (overlay.GET as unknown as () => Response)().json();
const put = (body: unknown, adult = true) =>
	(overlay.PUT as unknown as (e: unknown) => Promise<Response>)({
		locals: { adult: adult ? { id: 'adult', name: 'Test Adult' } : null },
		cookies: { get: () => undefined },
		request: new Request('http://example.com/x', { method: 'PUT', body: JSON.stringify(body) })
	});
const ALL_ON = { clock: true, date: true, weather: true, nextEvent: true };

it('has everything on by default', async () => {
	expect(await get()).toEqual(ALL_ON);
});

it('ignores corrupt rows', async () => {
	getDb().insert(schema.settings).values({ key: 'frame-overlay.date', value: '{oops' }).run();
	expect(await get()).toEqual(ALL_ON);
});

it('lets a grown-up turn overlays off and on', async () => {
	expect(await (await put({ weather: false })).json()).toEqual({ ...ALL_ON, weather: false });
	expect(await (await put({ clock: false, weather: true })).json()).toEqual({
		...ALL_ON,
		clock: false
	});
	expect(await get()).toEqual({ ...ALL_ON, clock: false });
});

it('rejects non-booleans without writing anything', async () => {
	await expect(put({ date: false, nextEvent: 'no' })).rejects.toMatchObject({ status: 400 });
	expect(await get()).toEqual({ ...ALL_ON, clock: false });
});

it('needs an adult', async () => {
	await expect(put({ clock: true }, false)).rejects.toMatchObject({ status: 401 });
});
