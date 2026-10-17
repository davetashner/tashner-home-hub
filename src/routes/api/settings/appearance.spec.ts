import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'hub-appearance-api-'));

const route = await import('./appearance/+server.js');
const get = () => (route.GET as unknown as () => Response)().json();
const put = (body: unknown, adult = true) =>
	(route.PUT as unknown as (e: unknown) => Promise<Response>)({
		locals: { adult: adult ? { id: 'adult', name: 'Test Adult' } : null },
		cookies: { get: () => undefined },
		request: new Request('http://example.com/x', { method: 'PUT', body: JSON.stringify(body) })
	});

it('defaults to Auto, 19:00 and 0.8 dimming', async () => {
	expect(await get()).toEqual({ theme: 'auto', eveningStart: '19:00', dim: 0.8 });
});

it('saves partial changes and turns dimming off', async () => {
	expect(await (await put({ theme: 'dark' })).json()).toMatchObject({ theme: 'dark', dim: 0.8 });
	await put({ dim: null, eveningStart: '20:30' });
	expect(await get()).toEqual({ theme: 'dark', eveningStart: '20:30', dim: null });
});

it('rejects bad values and needs an adult', async () => {
	await expect(put({ theme: 'neon' })).rejects.toMatchObject({ status: 400 });
	await expect(put({ dim: 0.2 })).rejects.toMatchObject({ status: 400 });
	await expect(put({ eveningStart: '08:00' })).rejects.toMatchObject({ status: 400 });
	await expect(put({ theme: 'light' }, false)).rejects.toMatchObject({ status: 401 });
	expect(await get()).toMatchObject({ theme: 'dark' });
});
