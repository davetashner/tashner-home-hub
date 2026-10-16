import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'hub-orientation-api-'));

const settings = await import('./orientation/+server.js');
const display = await import('../display/orientation/+server.js');
const readAgent = () => (display.GET as unknown as () => Response)().json();

const put = (body: unknown, adult = true) =>
	(settings.PUT as unknown as (e: unknown) => Promise<Response>)({
		locals: { adult: adult ? { id: 'adult', name: 'Test Adult' } : null },
		cookies: { get: () => undefined },
		request: new Request('http://example.com/x', { method: 'PUT', body: JSON.stringify(body) })
	});

it('defaults to normal landscape', async () => {
	expect(await readAgent()).toEqual({ rotation: 'normal', orientation: 'landscape' });
});

it('lets a grown-up rotate, and the agent endpoint follows', async () => {
	expect(await (await put({ rotation: '270' })).json()).toEqual({
		rotation: '270',
		orientation: 'portrait'
	});
	expect(await readAgent()).toEqual({ rotation: '270', orientation: 'portrait' });
});

it('rejects bad values and non-adults without writing', async () => {
	await expect(put({ rotation: 'sideways' })).rejects.toMatchObject({ status: 400 });
	await expect(put({ rotation: 'normal' }, false)).rejects.toMatchObject({ status: 401 });
	expect(await readAgent()).toEqual({ rotation: '270', orientation: 'portrait' });
});
