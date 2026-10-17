import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'hub-wave-api-'));

const route = await import('./wave-background/+server.js');
const get = () => (route.GET as unknown as () => Response)().json();
const put = (body: unknown, adult = true) =>
	(route.PUT as unknown as (e: unknown) => Promise<Response>)({
		locals: { adult: adult ? { id: 'adult', name: 'Test Adult' } : null },
		cookies: { get: () => undefined },
		request: new Request('http://example.com/x', { method: 'PUT', body: JSON.stringify(body) })
	});

it('defaults to auto', async () => {
	expect(await get()).toEqual({ choice: 'auto' });
});

it('lets a grown-up pick a background', async () => {
	expect(await (await put({ choice: 'off' })).json()).toEqual({ choice: 'off' });
	expect(await get()).toEqual({ choice: 'off' });
});

it('rejects unknown choices and needs an adult', async () => {
	await expect(put({ choice: 'neon' })).rejects.toMatchObject({ status: 400 });
	await expect(put({ choice: 'dusk' }, false)).rejects.toMatchObject({ status: 401 });
	expect(await get()).toEqual({ choice: 'off' });
});
