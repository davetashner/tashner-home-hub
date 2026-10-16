import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

type Handler = (event: never) => Promise<Response> | Response;
let get: Handler, post: Handler;
let state: typeof import('#lib/server/setup-state.js');
let layoutLoad: (e: never) => unknown;
let pageLoad: (e: never) => unknown;
let settingsLoad: (e: never) => unknown;

class FakeCookies {
	jar = new Map<string, { value: string; opts: Record<string, unknown> }>();
	get = (n: string) => this.jar.get(n)?.value;
	set = (n: string, value: string, opts: Record<string, unknown>) =>
		void this.jar.set(n, { value, opts });
	delete = (n: string) => void this.jar.delete(n);
}

function ev(body: unknown, addr = '10.0.0.1') {
	const cookies = new FakeCookies();
	return {
		cookies,
		event: {
			request: new Request('http://hub.test/api/setup', {
				method: 'POST',
				body: typeof body === 'string' ? body : JSON.stringify(body)
			}),
			cookies,
			url: new URL('http://hub.test/api/setup'),
			params: {},
			getClientAddress: () => addr,
			locals: { adult: null }
		}
	};
}

const call = async (h: Handler, e: object) => {
	try {
		return (await h(e as never)) ?? new Response(null, { status: 200 });
	} catch (err) {
		const s = err as { status?: number; location?: string };
		return new Response(s.location ?? null, { status: s.status ?? 500 });
	}
};

beforeAll(async () => {
	process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'hub-setup-api-'));
	process.env.HUB_SECRET_KEY = Buffer.alloc(32, 5).toString('base64');
	const route = await import('./+server.js');
	get = route.GET as Handler;
	post = route.POST as Handler;
	state = await import('#lib/server/setup-state.js');
	layoutLoad = (await import('../../(app)/+layout.server.js')).load as never;
	pageLoad = (await import('../../setup/+page.server.js')).load as never;
	settingsLoad = (await import('../../(app)/settings/+layout.server.js')).load as never;
});

const good = { name: 'Sam', color: 'member-1', avatar: '🦊', pin: '4817' };

describe('setup flow', () => {
	it('redirects app pages to /setup and lets /setup render while needed', async () => {
		expect(state.hubNeedsSetup()).toBe(true);
		expect((await call(layoutLoad as Handler, {})).status).toBe(303);
		expect((await call(pageLoad as Handler, {})).status).toBe(200);
		const res = await call(get, {});
		expect(await res.json()).toEqual({ needsSetup: true });
	});

	it('rejects a weak PIN with 400 and leaves setup open', async () => {
		const res = await call(post, ev({ ...good, pin: '1234' }).event);
		expect(res.status).toBe(400);
		expect(state.hubNeedsSetup()).toBe(true);
	});

	it('rejects non-JSON bodies', async () => {
		expect((await call(post, ev('nope').event)).status).toBe(400);
	});

	it('creates the adult, issues a session cookie, then returns 409', async () => {
		const { cookies, event } = ev({ ...good, remember: true });
		const res = await call(post, event);
		expect(res.status).toBe(201);
		const session = cookies.jar.get('hub_session');
		expect(session?.opts.httpOnly).toBe(true);
		expect(session?.opts.maxAge).toBeGreaterThan(24 * 3600);
		expect((await call(post, ev(good).event)).status).toBe(409);
		expect(await (await call(get, {})).json()).toEqual({ needsSetup: false });
	});

	it('then app pages load, /setup redirects home, and settings need a session', async () => {
		expect(state.hubNeedsSetup()).toBe(false);
		expect((await call(layoutLoad as Handler, {})).status).toBe(200);
		expect((await call(pageLoad as Handler, {})).status).toBe(303);
		const url = new URL('http://hub.test/settings/family?x=1');
		const denied = await call(settingsLoad as Handler, { locals: { adult: null }, url });
		expect(denied.status).toBe(303);
		expect(await denied.text()).toBe('/unlock?next=%2Fsettings%2Ffamily%3Fx%3D1');
		const ok = await call(settingsLoad as Handler, {
			locals: { adult: { id: 'a', name: 'A' } },
			url
		});
		expect(ok.status).toBe(200);
	});
});
