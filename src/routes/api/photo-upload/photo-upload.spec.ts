import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { openDb, schema, type Db } from '#lib/server/db/index.js';
import { syntheticJpeg } from '#lib/server/photo-cache/fixtures.js';

const base = mkdtempSync(join(tmpdir(), 'hub-upapi-'));
process.env.DATA_DIR = base;
let db: Db;
vi.mock('#lib/server/db/index.js', async (orig) => ({
	...(await orig<typeof import('#lib/server/db/index.js')>()),
	getDb: () => db
}));
vi.mock('#lib/server/photo-source/prerender.js', async (orig) => ({
	...(await orig<typeof import('#lib/server/photo-source/prerender.js')>()),
	enqueuePrerender: vi.fn()
}));
const { POST } = await import('./+server.js');

type Reply = { status: number; body: { sourceId?: string; message?: string } };
const post = async (
	body: Uint8Array | string,
	opts: { adult?: boolean; type?: string; length?: string } = {}
) => {
	const headers: Record<string, string> = { 'content-type': opts.type ?? 'image/jpeg' };
	if (opts.length) headers['content-length'] = opts.length;
	const event = {
		locals: { adult: opts.adult === false ? null : { id: 'a', name: 'A' } },
		request: new Request('http://hub/api/photo-upload', {
			method: 'POST',
			headers,
			body: typeof body === 'string' ? body : new Uint8Array(body)
		})
	};
	try {
		const res = await POST(event as never);
		return { status: res.status, body: await res.json() } as Reply;
	} catch (e) {
		const err = e as { status: number; body?: { message?: string } };
		return { status: err.status, body: { message: err.body?.message } } as Reply;
	}
};

beforeAll(() => {
	db = openDb(':memory:');
});
afterAll(() => rmSync(base, { recursive: true, force: true }));

describe('POST /api/photo-upload', () => {
	it('needs an adult and an image body', async () => {
		const jpg = await syntheticJpeg(30, 20);
		expect((await post(jpg, { adult: false })).status).toBe(401);
		expect((await post(jpg, { type: 'multipart/form-data; boundary=x' })).status).toBe(415);
		expect((await post(jpg, { length: String(64 * 1024 * 1024) })).status).toBe(413);
		const bad = await post('definitely not an image');
		expect(bad).toMatchObject({ status: 400, body: { message: 'That file is not a photo' } });
	});

	it('stores the photo in the From phones album', async () => {
		const res = await post(await syntheticJpeg(30, 20));
		expect(res.status).toBe(201);
		const rows = db.select().from(schema.photos).all();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ sourceId: res.body.sourceId, album: 'From phones' });
	});
});
