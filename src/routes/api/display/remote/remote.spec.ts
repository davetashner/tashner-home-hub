import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'hub-display-remote-'));

const { getDb } = await import('#lib/server/db/index.js');
const { createToken } = await import('#lib/server/domain/api-tokens.js');
const { currentDisplayPower } = await import('#lib/server/display.js');
const remote = await import('./+server.js');

const call = (body: unknown, auth?: string) =>
	(remote.POST as (e: unknown) => Promise<Response>)({
		request: new Request('http://hub.example.test/api/display/remote', {
			method: 'POST',
			headers: auth ? { authorization: `Bearer ${auth}` } : {},
			body: typeof body === 'string' ? body : JSON.stringify(body)
		})
	});

describe('POST /api/display/remote', () => {
	const ha = createToken(getDb(), 'Test HA', ['display:power']);
	const siriOnly = createToken(getDb(), 'Test Phone', ['lists:add']);

	it('sleeps and wakes the display through the same path as the wall buttons', async () => {
		const slept = await call({ state: 'sleep' }, ha.token);
		expect(slept.status).toBe(200);
		expect(slept.headers.get('cache-control')).toBe('no-store');
		expect(await slept.json()).toMatchObject({ ok: true, state: 'sleep', power: 'off' });
		expect(currentDisplayPower().power).toBe('off');
		const woke = await call({ state: 'wake' }, ha.token);
		expect(await woke.json()).toMatchObject({ ok: true, state: 'wake', power: 'on' });
		expect(currentDisplayPower().power).toBe('on');
	});

	it('rejects a bad body with 400 and changes nothing', async () => {
		for (const body of [{ state: 'toggle' }, {}, 'not json', []]) {
			expect((await call(body, ha.token)).status).toBe(400);
		}
	});

	it('403s a token without the display scope', async () => {
		expect((await call({ state: 'wake' }, siriOnly.token)).status).toBe(403);
	});

	it('401s missing, malformed and unknown tokens without leaking why', async () => {
		const bodies = [];
		for (const auth of [undefined, 'short', 'a'.repeat(43)]) {
			const res = await call({ state: 'wake' }, auth);
			expect(res.status).toBe(401);
			bodies.push(await res.text());
		}
		expect(new Set(bodies).size).toBe(1);
	});

	it('rate limits a token, and rejected attempts overall', async () => {
		let last = 200;
		for (let i = 0; i < 70; i++) last = (await call({ state: 'wake' }, ha.token)).status;
		expect(last).toBe(429);
		let bad = 401;
		for (let i = 0; i < 30; i++) bad = (await call({ state: 'wake' }, 'z'.repeat(43))).status;
		expect(bad).toBe(429);
	});
});
