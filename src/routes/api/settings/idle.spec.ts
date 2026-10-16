import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'hub-idle-api-'));

const { getDb, schema } = await import('#lib/server/db/index.js');
const idle = await import('./idle/+server.js');
const get = () => (idle.GET as unknown as () => Response)().json();
const put = (body: unknown, adult = true) =>
	(idle.PUT as unknown as (e: unknown) => Promise<Response>)({
		locals: { adult: adult ? { id: 'adult', name: 'Test Adult' } : null },
		cookies: { get: () => undefined },
		request: new Request('http://example.com/x', { method: 'PUT', body: JSON.stringify(body) })
	});

it('defaults to home after 2 minutes and the photo frame after 5', async () => {
	expect(await get()).toEqual({ homeMinutes: 2, frameMinutes: 5 });
});

it('ignores corrupt rows', async () => {
	getDb().insert(schema.settings).values({ key: 'idle.homeMinutes', value: '{oops' }).run();
	expect(await get()).toEqual({ homeMinutes: 2, frameMinutes: 5 });
});

it('lets a grown-up change the timers', async () => {
	expect(await (await put({ homeMinutes: 1 })).json()).toEqual({ homeMinutes: 1, frameMinutes: 5 });
	expect(await (await put({ homeMinutes: 3, frameMinutes: 0 })).json()).toEqual({
		homeMinutes: 3,
		frameMinutes: 0
	});
	expect(await get()).toEqual({ homeMinutes: 3, frameMinutes: 0 });
});

it('rejects bad values without writing anything', async () => {
	await expect(put({ homeMinutes: 4, frameMinutes: -1 })).rejects.toMatchObject({ status: 400 });
	expect(await get()).toEqual({ homeMinutes: 3, frameMinutes: 0 });
});

it('needs an adult', async () => {
	await expect(put({ homeMinutes: 9 }, false)).rejects.toMatchObject({ status: 401 });
});
