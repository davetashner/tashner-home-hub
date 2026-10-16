import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'hub-slideshow-api-'));

const { getDb, schema } = await import('#lib/server/db/index.js');
const slideshow = await import('./slideshow/+server.js');
const get = () => (slideshow.GET as unknown as () => Response)().json();
const put = (body: unknown, adult = true) =>
	(slideshow.PUT as unknown as (e: unknown) => Promise<Response>)({
		locals: { adult: adult ? { id: 'adult', name: 'Test Adult' } : null },
		cookies: { get: () => undefined },
		request: new Request('http://example.com/x', { method: 'PUT', body: JSON.stringify(body) })
	});

it('defaults to a 30 second fade', async () => {
	expect(await get()).toEqual({ intervalSeconds: 30, transition: 'fade' });
});

it('ignores corrupt rows', async () => {
	getDb().insert(schema.settings).values({ key: 'slideshow.transition', value: '{oops' }).run();
	expect(await get()).toEqual({ intervalSeconds: 30, transition: 'fade' });
});

it('lets a grown-up change the interval and transition', async () => {
	expect(await (await put({ intervalSeconds: 60 })).json()).toEqual({
		intervalSeconds: 60,
		transition: 'fade'
	});
	expect(await (await put({ transition: 'kenburns' })).json()).toEqual({
		intervalSeconds: 60,
		transition: 'kenburns'
	});
	expect(await get()).toEqual({ intervalSeconds: 60, transition: 'kenburns' });
});

it('rejects bad values without writing anything', async () => {
	await expect(put({ intervalSeconds: 7 })).rejects.toMatchObject({ status: 400 });
	await expect(put({ intervalSeconds: 10, transition: 'wipe' })).rejects.toMatchObject({
		status: 400
	});
	expect(await get()).toEqual({ intervalSeconds: 60, transition: 'kenburns' });
});

it('needs an adult', async () => {
	await expect(put({ intervalSeconds: 10 }, false)).rejects.toMatchObject({ status: 401 });
});
