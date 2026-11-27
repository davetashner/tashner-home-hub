import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

const dir = mkdtempSync(join(tmpdir(), 'hub-siri-photo-'));
process.env.DATA_DIR = dir;
vi.mock('#lib/server/photo-source/prerender.js', async (orig) => ({
	...(await orig<typeof import('#lib/server/photo-source/prerender.js')>()),
	enqueuePrerender: vi.fn()
}));

const { getDb, schema } = await import('#lib/server/db/index.js');
const { createToken } = await import('#lib/server/domain/api-tokens.js');
const events = await import('#lib/server/domain/events.js');
const { syntheticJpeg } = await import('#lib/server/photo-cache/fixtures.js');
const route = await import('./+server.js');

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const call = async (
	body: Uint8Array | string,
	opts: { auth?: string; type?: string; qs?: string; length?: string } = {}
) => {
	const headers: Record<string, string> = { 'content-type': opts.type ?? 'image/jpeg' };
	if (opts.auth) headers.authorization = `Bearer ${opts.auth}`;
	if (opts.length) headers['content-length'] = opts.length;
	const url = new URL(`http://hub.example.test/api/siri/photo${opts.qs ?? ''}`);
	const res = await (route.POST as (e: unknown) => Promise<Response>)({
		url,
		request: new Request(url, {
			method: 'POST',
			headers,
			body: typeof body === 'string' ? body : new Uint8Array(body)
		})
	});
	return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

describe('POST /api/siri/photo', () => {
	const phone = createToken(getDb(), 'Test Phone', ['photos:add']);
	const lists = createToken(getDb(), 'Lists Phone', ['lists:add']);

	it('needs a token with the photos scope and an image body', async () => {
		const jpg = await syntheticJpeg(30, 20);
		expect((await call(jpg)).status).toBe(401);
		expect((await call(jpg, { auth: lists.token })).status).toBe(403);
		expect((await call(jpg, { auth: phone.token, type: 'application/json' })).status).toBe(415);
		expect((await call(jpg, { auth: phone.token, length: String(64 * 1024 * 1024) })).status).toBe(
			413
		);
		const bad = await call('not a photo at all', { auth: phone.token });
		expect(bad).toMatchObject({
			status: 400,
			body: { ok: false, speak: 'That file is not a photo.' }
		});
	});

	it('stores the photo, and shows it on the wall when asked', async () => {
		const seen: Record<string, string>[] = [];
		const off = events.subscribe(['frame'], (e) => seen.push(e.data))!;
		const quiet = await call(await syntheticJpeg(30, 20), { auth: phone.token });
		expect(quiet).toMatchObject({ status: 200, body: { ok: true, speak: 'Sent to the hub.' } });
		expect(seen).toEqual([]);
		const shown = await call(await syntheticJpeg(40, 20), { auth: phone.token, qs: '?show=1' });
		expect(shown.body.speak).toBe('Sent to the hub and on the wall.');
		expect(seen).toEqual([{ photo: shown.body.photoId }]);
		off();
		const rows = getDb().select().from(schema.photos).all();
		expect(rows.map((r) => r.album)).toEqual(['From phones', 'From phones']);
		expect(rows.map((r) => r.id)).toContain(quiet.body.photoId);
	});
});
