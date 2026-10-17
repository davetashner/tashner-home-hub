import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'hub-notify-api-'));

const { getDb, schema } = await import('#lib/server/db/index.js');
const route = await import('./notifications/+server.js');

type Handler = (e: unknown) => Response | Promise<Response>;
const call = (h: unknown, body?: unknown, adult = true) =>
	(h as Handler)({
		locals: { adult: adult ? { id: 'adult', name: 'Test Adult' } : null },
		cookies: { get: () => undefined },
		request: new Request('http://example.com/x', { method: 'PUT', body: JSON.stringify(body) })
	});
const SECRET = 'tk_apisecret';

it('starts with defaults, saves settings, and keeps the token write-only and encrypted', async () => {
	expect(await (await call(route.GET)).json()).toMatchObject({ enabled: false, tokenSaved: false });
	const res = await (
		await call(route.PUT, { enabled: true, topic: 'abc', token: SECRET, events: { goal: false } })
	).json();
	expect(res).toMatchObject({ enabled: true, topic: 'abc', tokenSaved: true });
	expect(JSON.stringify(res)).not.toContain(SECRET);
	expect(JSON.stringify(getDb().select().from(schema.settings).all())).not.toContain(SECRET);
	expect(await (await call(route.PUT, { token: '' })).json()).toMatchObject({ tokenSaved: false });
});

it('rejects bad input and non-adults', async () => {
	await expect(call(route.PUT, { topic: 'no spaces' })).rejects.toMatchObject({ status: 400 });
	await expect(call(route.PUT, { topic: 'abc' }, false)).rejects.toMatchObject({ status: 401 });
});

it('sends a test and records the result', async () => {
	const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
	vi.stubGlobal('fetch', fetchMock);
	expect(await (await call(route.POST, {})).json()).toMatchObject({ ok: true, detail: 'Sent' });
	expect(fetchMock.mock.calls[0]![0]).toBe('https://ntfy.sh/abc');
	expect((await (await call(route.GET)).json()).last).toMatchObject({ ok: true });
	vi.unstubAllGlobals();
});
