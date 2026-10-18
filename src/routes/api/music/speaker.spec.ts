import { afterEach, describe, expect, it, vi } from 'vitest';

const status = await import('./speaker/+server.js');
const scan = await import('./speaker/scan/+server.js');
const use = await import('./speaker/use/+server.js');
const test = await import('./speaker/test/+server.js');

const ev = (over: Record<string, unknown>) => over as never;
const adult = { locals: { adult: { id: 'a1', name: 'Adult' } } };
const post = (body: unknown) =>
	new Request('http://h/x', { method: 'POST', body: JSON.stringify(body) });

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

describe('speaker routes', () => {
	it('lets anyone read the state, and only adults scan, pair or test', async () => {
		vi.stubEnv('HUB_KIOSK_SPEAKER_URL', '');
		const res = await status.GET(ev({ locals: {} }));
		expect(await res.json()).toMatchObject({ state: 'not_configured' });
		expect(() => scan.POST(ev({ locals: {} }))).toThrow();
		await expect(use.POST(ev({ locals: {}, request: post({ mac: 'x' }) }))).rejects.toBeDefined();
		expect(() => test.POST(ev({ locals: {} }))).toThrow();
	});

	it('proxies to the Pi and maps its errors', async () => {
		vi.stubEnv('HUB_KIOSK_SPEAKER_URL', 'http://kiosk.example:8742');
		vi.stubEnv('HUB_KIOSK_SPEAKER_TOKEN', 'tok');
		const fetch = vi.fn(async (url: string) =>
			url.endsWith('/scan')
				? new Response(JSON.stringify({ devices: [] }))
				: new Response(JSON.stringify({ error: 'Speaker is off' }), { status: 409 })
		);
		vi.stubGlobal('fetch', fetch);
		expect(await (await scan.POST(ev(adult))).json()).toEqual([]);
		const failed = await test.POST(ev(adult));
		expect(failed.status).toBe(409);
		expect(await failed.json()).toEqual({ code: 'failed', message: 'Speaker is off' });
		const bad = await use.POST(ev({ ...adult, request: post({ mac: 'nope' }) }));
		expect(bad.status).toBe(400);
		expect(fetch).toHaveBeenCalledTimes(2);
	});
});
