import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'hub-sound-api-'));

const { getDb, schema } = await import('#lib/server/db/index.js');
const sound = await import('./sound/+server.js');
const get = () => (sound.GET as unknown as () => Response)().json();

it('defaults to unmuted with quiet hours 20:00 to 07:00', async () => {
	expect(await get()).toMatchObject({
		muted: false,
		quietStart: '20:00',
		quietEnd: '07:00',
		theme: 'classic',
		volume: 100
	});
});

it('reads settings rows and ignores corrupt ones', async () => {
	const db = getDb();
	db.insert(schema.settings)
		.values([
			{ key: 'sound.muted', value: 'true' },
			{ key: 'sound.quietStart', value: '{oops' },
			{ key: 'sound.quietEnd', value: '"06:00"' }
		])
		.run();
	expect(await get()).toMatchObject({ muted: true, quietStart: '20:00', quietEnd: '06:00' });
});

const put = (body: unknown, adult = true) =>
	(sound.PUT as unknown as (e: unknown) => Promise<Response>)({
		locals: { adult: adult ? { id: 'adult', name: 'Test Adult' } : null },
		cookies: { get: () => undefined },
		request: new Request('http://example.com/x', { method: 'PUT', body: JSON.stringify(body) })
	});

it('lets a grown-up mute and change quiet hours', async () => {
	expect(await (await put({ muted: false, quietStart: '21:30' })).json()).toMatchObject({
		muted: false,
		quietStart: '21:30',
		quietEnd: '06:00'
	});
	expect(await (await put({ quietEnd: '06:45', muted: true })).json()).toMatchObject({
		muted: true,
		quietStart: '21:30',
		quietEnd: '06:45'
	});
	expect(await get()).toMatchObject({ muted: true, quietStart: '21:30', quietEnd: '06:45' });
});

it('rejects bad values without writing anything', async () => {
	await expect(put({ muted: 'no' })).rejects.toMatchObject({ status: 400 });
	await expect(put({ muted: false, quietStart: '9:00' })).rejects.toMatchObject({ status: 400 });
	await expect(put({ quietEnd: '24:00' })).rejects.toMatchObject({ status: 400 });
	expect(await get()).toMatchObject({ muted: true, quietStart: '21:30', quietEnd: '06:45' });
});

it('saves the theme and volume, and reports the household zone', async () => {
	const saved = await (await put({ theme: 'arcade', volume: 35 })).json();
	expect(saved).toMatchObject({ theme: 'arcade', volume: 35 });
	expect(typeof saved.timeZone).toBe('string');
	await expect(put({ theme: 'nope' })).rejects.toMatchObject({ status: 400 });
	await expect(put({ volume: 101 })).rejects.toMatchObject({ status: 400 });
	expect(await get()).toMatchObject({ theme: 'arcade', volume: 35 });
});

it('needs an adult', async () => {
	await expect(put({ muted: false }, false)).rejects.toMatchObject({ status: 401 });
});
