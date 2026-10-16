import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '#lib/server/db/index.js';
import { photoSources, photos } from '#lib/server/db/schema.js';
import { syntheticJpeg } from '#lib/server/photo-cache/fixtures.js';

const root = mkdtempSync(join(tmpdir(), 'hub-photo-api-'));
process.env.DATA_DIR = root;
let db: Db;
vi.mock('#lib/server/db/index.js', async (orig) => ({
	...(await orig<typeof import('#lib/server/db/index.js')>()),
	getDb: () => db
}));
const { GET } = await import('./[id]/+server.js');

const call = async (id: string, qs = '', headers: Record<string, string> = {}) => {
	try {
		return await GET({
			params: { id },
			url: new URL(`http://hub/api/photo/${id}${qs}`),
			request: new Request(`http://hub/api/photo/${id}${qs}`, { headers })
		} as never);
	} catch (e) {
		return e as { status: number };
	}
};

beforeAll(async () => {
	db = openDb(':memory:');
	db.insert(photoSources).values({ id: 's', kind: 'folder', label: 't' }).run();
	const f = join(root, 'p.jpg');
	writeFileSync(f, await syntheticJpeg(300, 400));
	db.insert(photos).values({ id: 'p', sourceId: 's', filePath: f }).run();
	const h = join(root, 'h.jpg');
	writeFileSync(h, await syntheticJpeg(30, 40));
	db.insert(photos).values({ id: 'h', sourceId: 's', filePath: h, hidden: true }).run();
	db.insert(photos)
		.values({ id: 'gone', sourceId: 's', filePath: join(root, 'x.jpg') })
		.run();
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('GET /api/photo/[id]', () => {
	it('renders on demand with immutable caching headers and an ETag', async () => {
		const res = (await call('p', '?w=640&h=360&fmt=webp')) as Response;
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('image/webp');
		expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
		const etag = res.headers.get('etag')!;
		expect(etag).toMatch(/^"[0-9a-f]+-640x360-main-webp"$/);
		const body = Buffer.from(await res.arrayBuffer());
		const meta = await sharp(body).metadata();
		expect([meta.width, meta.height]).toEqual([270, 360]);
		expect(meta.exif).toBeUndefined();

		const again = (await call('p', '?w=640&h=360&fmt=webp', { 'if-none-match': etag })) as Response;
		expect(again.status).toBe(304);
	});

	it('404s for unknown, hidden, missing-file photos and missing backdrops', async () => {
		for (const id of ['nope', 'h', 'gone'])
			expect(((await call(id, '?w=640&h=360')) as { status: number }).status).toBe(404);
	});

	it('400s on bad parameters', async () => {
		for (const qs of ['?w=5&h=360', '?w=640&h=x', '?fmt=gif', '?part=top'])
			expect(((await call('p', qs)) as { status: number }).status).toBe(400);
	});
});
