import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '#lib/server/db/index.js';
import { photoSources, photos } from '#lib/server/db/schema.js';

const root = mkdtempSync(join(tmpdir(), 'hub-motion-api-'));
let db: Db;
vi.mock('#lib/server/db/index.js', async (orig) => ({
	...(await orig<typeof import('#lib/server/db/index.js')>()),
	getDb: () => db
}));
const { GET } = await import('./[id]/motion/+server.js');

const call = async (id: string, range?: string) => {
	try {
		return (await GET({
			params: { id },
			request: new Request(`http://hub/api/photo/${id}/motion`, {
				headers: range ? { range } : {}
			})
		} as never)) as Response;
	} catch (e) {
		return e as { status: number };
	}
};

beforeAll(() => {
	db = openDb(':memory:');
	db.insert(photoSources).values({ id: 's', kind: 'other', label: 't' }).run();
	const clip = join(root, 'a.mov');
	writeFileSync(clip, '0123456789');
	symlinkSync(clip, join(root, 'link.mov'));
	db.insert(photos)
		.values({ id: 'live', sourceId: 's', filePath: join(root, 'a.jpg'), motionPath: clip })
		.run();
	db.insert(photos)
		.values({ id: 'plain', sourceId: 's', filePath: join(root, 'b.jpg') })
		.run();
	db.insert(photos)
		.values({
			id: 'gone',
			sourceId: 's',
			filePath: join(root, 'c.jpg'),
			motionPath: join(root, 'no.mov')
		})
		.run();
	db.insert(photos)
		.values({
			id: 'link',
			sourceId: 's',
			filePath: join(root, 'd.jpg'),
			motionPath: join(root, 'link.mov')
		})
		.run();
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('GET /api/photo/[id]/motion', () => {
	it('serves the whole clip, uncacheable, advertising ranges', async () => {
		const res = (await call('live')) as Response;
		expect(res.status).toBe(200);
		expect(res.headers.get('accept-ranges')).toBe('bytes');
		expect(res.headers.get('cache-control')).toContain('no-store');
		expect(await res.text()).toBe('0123456789');
	});
	it('answers a byte range with 206 and a Content-Range', async () => {
		const res = (await call('live', 'bytes=2-5')) as Response;
		expect(res.status).toBe(206);
		expect(res.headers.get('content-range')).toBe('bytes 2-5/10');
		expect(res.headers.get('content-length')).toBe('4');
		expect(await res.text()).toBe('2345');
		const tail = (await call('live', 'bytes=-3')) as Response;
		expect(await tail.text()).toBe('789');
	});
	it('answers an out-of-range request with 416', async () => {
		const res = (await call('live', 'bytes=50-')) as Response;
		expect(res.status).toBe(416);
		expect(res.headers.get('content-range')).toBe('bytes */10');
	});
	it('404s for photos without a clip, missing files, symlinks and unknown ids', async () => {
		for (const id of ['plain', 'gone', 'link', 'nope'])
			expect(await call(id)).toMatchObject({ status: 404 });
	});
});
