import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

type Handler = (event: never) => Promise<Response> | Response;
let login: Handler, logout: Handler, setPin: Handler;
let db: typeof import('#lib/server/db/index.js');
let auth: typeof import('#lib/server/auth.js');

class FakeCookies {
	jar = new Map<string, { value: string; opts: Record<string, unknown> }>();
	get = (n: string) => this.jar.get(n)?.value;
	set = (n: string, value: string, opts: Record<string, unknown>) =>
		void this.jar.set(n, { value, opts });
	delete = (n: string) => void this.jar.delete(n);
}

function ev(
	body: unknown,
	opts: { addr?: string; cookies?: FakeCookies; params?: object; adult?: boolean } = {}
) {
	const cookies = opts.cookies ?? new FakeCookies();
	const request = new Request('http://hub.test/x', {
		method: 'POST',
		body: typeof body === 'string' ? body : JSON.stringify(body)
	});
	const url = new URL('http://hub.test/x');
	const e = {
		request,
		cookies,
		url,
		params: opts.params ?? {},
		getClientAddress: () => opts.addr ?? '10.0.0.1',
		locals: { adult: null as App.Locals['adult'] }
	};
	return e;
}

const call = async (h: Handler, e: object) => {
	try {
		return await h(e as never);
	} catch (err) {
		const s = err as { status?: number };
		return new Response(null, { status: s.status ?? 500 });
	}
};

beforeAll(async () => {
	process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'hub-auth-'));
	process.env.HUB_SECRET_KEY = Buffer.alloc(32, 3).toString('base64');
	db = await import('#lib/server/db/index.js');
	auth = await import('#lib/server/auth.js');
	login = (await import('./pin/+server.js')).POST as Handler;
	logout = (await import('./logout/+server.js')).POST as Handler;
	setPin = (await import('../members/[id]/pin/+server.js')).POST as Handler;
	const { hashPin } = await import('#lib/server/domain/pin.js');
	db.getDb()
		.insert(db.schema.members)
		.values([
			{ id: 'a1', name: 'Test Adult', role: 'adult', color: 'x', pinHash: hashPin('4817') },
			{ id: 'a2', name: 'Other Adult', role: 'adult', color: 'x' },
			{ id: 'k1', name: 'Test Kid', role: 'child', color: 'x' }
		])
		.run();
});

describe('POST /api/auth/pin', () => {
	it('rejects malformed bodies', async () => {
		expect((await call(login, ev('nope'))).status).toBe(400);
		expect((await call(login, ev({ memberId: 'a1' }))).status).toBe(400);
	});

	it('issues an HttpOnly SameSite=Strict wall session on success', async () => {
		const e = ev({ memberId: 'a1', pin: '4817' }, { addr: '10.0.1.1' });
		const res = await call(login, e);
		expect(res.status).toBe(200);
		const c = e.cookies.jar.get(auth.SESSION_COOKIE)!;
		expect(c.opts).toMatchObject({
			httpOnly: true,
			sameSite: 'strict',
			secure: false,
			maxAge: 120
		});
		// The cookie authenticates later requests.
		const next = ev({}, { cookies: e.cookies });
		expect(auth.resolveAdult(next as never)).toEqual({ id: 'a1', name: 'Test Adult' });
	});

	it('never marks the cookie Secure on the plain-http LAN, though adapter-node claims https', async () => {
		// Production: adapter-node defaults event.url to https; only the socket knows the truth.
		const plain = { socket: {}, headers: {} };
		const e = {
			...ev({ memberId: 'a1', pin: '4817' }, { addr: '10.0.1.3' }),
			url: new URL('https://192.168.0.4:3000/api/auth/pin'),
			platform: { req: plain }
		};
		expect((await call(login, e)).status).toBe(200);
		expect(e.cookies.jar.get(auth.SESSION_COOKIE)!.opts.secure).toBe(false);
	});

	it('marks the cookie Secure behind TLS: an encrypted socket or an https proxy', () => {
		const url = new URL('https://hub.test/x');
		const tls = { socket: { encrypted: true }, headers: {} };
		const proxied = { socket: {}, headers: { 'x-forwarded-proto': 'https' } };
		expect(auth.overHttps({ url, platform: { req: tls } } as never)).toBe(true);
		expect(auth.overHttps({ url, platform: { req: proxied } } as never)).toBe(true);
		expect(auth.overHttps({ url: new URL('http://hub.test/x') } as never)).toBe(false);
	});

	it('remember=true gives a 30 day cookie', async () => {
		const e = ev({ memberId: 'a1', pin: '4817', remember: true }, { addr: '10.0.1.2' });
		await call(login, e);
		expect(e.cookies.jar.get(auth.SESSION_COOKIE)!.opts.maxAge).toBe(30 * 24 * 3600);
	});

	it('refuses wrong PINs, children, PIN-less and unknown members', async () => {
		for (const [memberId, pin] of [
			['a1', '9999'],
			['k1', '4817'],
			['a2', '4817'],
			['zz', '4817']
		]) {
			const e = ev({ memberId, pin }, { addr: `10.0.2.${memberId}` });
			expect((await call(login, e)).status).toBe(401);
			expect(e.cookies.jar.size).toBe(0);
		}
	});

	it('locks after 5 wrong attempts, even for the right PIN', async () => {
		const addr = '10.0.3.1';
		for (let i = 0; i < 4; i++)
			expect((await call(login, ev({ memberId: 'a1', pin: '0001' }, { addr }))).status).toBe(401);
		const fifth = await call(login, ev({ memberId: 'a1', pin: '0001' }, { addr }));
		expect(fifth.status).toBe(401);
		expect((await fifth.json()).retryAfterMs).toBe(60_000);
		const locked = await call(login, ev({ memberId: 'a1', pin: '4817' }, { addr }));
		expect(locked.status).toBe(429);
		expect(Number(locked.headers.get('retry-after'))).toBeGreaterThan(0);
		// Another device is unaffected.
		expect(
			(await call(login, ev({ memberId: 'a1', pin: '4817' }, { addr: '10.0.3.2' }))).status
		).toBe(200);
	});
});

describe('session resolution', () => {
	it('ignores forged, expired and orphaned sessions', () => {
		const forged = new FakeCookies();
		forged.set(auth.SESSION_COOKIE, 'a.b', {});
		expect(auth.resolveAdult(ev({}, { cookies: forged }) as never)).toBeNull();
		expect(forged.get(auth.SESSION_COOKIE)).toBeUndefined();

		const none = ev({});
		expect(auth.resolveAdult(none as never)).toBeNull();

		const kid = ev({});
		auth.issueSession(kid as never, 'k1', true);
		expect(auth.resolveAdult(kid as never)).toBeNull();
	});

	it('requireAdult throws 401 without a session and returns the adult with one', () => {
		const e = ev({});
		expect(() => auth.requireAdult(e as never)).toThrow(expect.objectContaining({ status: 401 }));
		e.locals.adult = { id: 'a1', name: 'Test Adult' };
		expect(auth.requireAdult(e as never)).toEqual(e.locals.adult);
		expect(auth.currentAdult(e)).toEqual(e.locals.adult);
	});
});

describe('POST /api/auth/logout', () => {
	it('clears the cookie', async () => {
		const e = ev({}, { addr: '10.0.4.1' });
		auth.issueSession(e as never, 'a1', false);
		expect((await call(logout, e)).status).toBe(200);
		expect(e.cookies.jar.size).toBe(0);
	});

	it('leaves later requests without an adult, and is safe with no session', async () => {
		const cookies = new FakeCookies();
		auth.issueSession(ev({}, { cookies }) as never, 'a1', true);
		expect(auth.resolveAdult(ev({}, { cookies }) as never)).not.toBeNull();
		expect((await call(logout, ev({}, { cookies }))).status).toBe(200);
		expect(auth.resolveAdult(ev({}, { cookies }) as never)).toBeNull();
		expect((await call(logout, ev({}))).status).toBe(200);
	});
});

describe('session revocation', () => {
	const unlock = async (addr: string) => {
		const e = ev({ memberId: 'a1', pin: '4817', remember: true }, { addr });
		await call(login, e);
		return e.cookies.get(auth.SESSION_COOKIE)!;
	};
	const withToken = (token: string) => {
		const cookies = new FakeCookies();
		cookies.set(auth.SESSION_COOKIE, token, {});
		return ev({}, { cookies });
	};

	it('logout voids a copied cookie but a fresh unlock works', async () => {
		const token = await unlock('10.0.6.1');
		const copy = token;
		const mine = withToken(token);
		expect(auth.resolveAdult(mine as never)).not.toBeNull();
		await call(logout, mine);
		expect(auth.resolveAdult(withToken(copy) as never)).toBeNull();
		const fresh = await unlock('10.0.6.2');
		expect(auth.resolveAdult(withToken(fresh) as never)).toEqual({
			id: 'a1',
			name: 'Test Adult'
		});
	});

	it('logout without a valid session does not revoke anyone', async () => {
		const token = await unlock('10.0.6.3');
		await call(logout, ev({}));
		expect(auth.resolveAdult(withToken(token) as never)).not.toBeNull();
	});

	it("changing a PIN voids that member's existing sessions only", async () => {
		const token = await unlock('10.0.6.4');
		const e = ev({ pin: '6203' }, { params: { id: 'a2' } });
		e.locals.adult = { id: 'a1', name: 'Test Adult' };
		await call(setPin, e);
		expect(auth.resolveAdult(withToken(token) as never)).not.toBeNull();
		const e2 = ev({ pin: '6204' }, { params: { id: 'a1' } });
		e2.locals.adult = { id: 'a1', name: 'Test Adult' };
		await call(setPin, e2);
		expect(auth.resolveAdult(withToken(token) as never)).toBeNull();
	});
});

describe('POST /api/members/[id]/pin', () => {
	it('requires an adult session once any PIN exists', async () => {
		const res = await call(setPin, ev({ pin: '7391' }, { params: { id: 'a2' } }));
		expect(res.status).toBe(401);
	});

	it('lets an adult set a PIN, validating strength, role and existence', async () => {
		const as = (body: unknown, id: string) => {
			const e = ev(body, { params: { id } });
			e.locals.adult = { id: 'a1', name: 'Test Adult' };
			return e;
		};
		expect((await call(setPin, as({ pin: '1234' }, 'a2'))).status).toBe(400);
		expect((await call(setPin, as({ pin: '7391' }, 'k1'))).status).toBe(400);
		expect((await call(setPin, as({ pin: '7391' }, 'nobody'))).status).toBe(404);
		expect((await call(setPin, as({ pin: '7391' }, 'a2'))).status).toBe(200);
		const res = await call(login, ev({ memberId: 'a2', pin: '7391' }, { addr: '10.0.5.1' }));
		expect(res.status).toBe(200);
	});

	it('allows first-run setup when no one has a PIN yet', async () => {
		db.getDb().update(db.schema.members).set({ pinHash: null }).run();
		const res = await call(setPin, ev({ pin: '5920' }, { params: { id: 'a1' } }));
		expect(res.status).toBe(200);
		// Now locked down again.
		expect((await call(setPin, ev({ pin: '5921' }, { params: { id: 'a2' } }))).status).toBe(401);
	});
});
