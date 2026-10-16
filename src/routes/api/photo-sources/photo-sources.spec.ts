import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { openDb, schema, type Db } from '#lib/server/db/index.js';
import { syntheticJpeg } from '#lib/server/photo-cache/fixtures.js';

const base = mkdtempSync(join(tmpdir(), 'hub-psapi-'));
const root = join(base, 'ok', 'lib');
process.env.HUB_PHOTO_ROOTS = join(base, 'ok');
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
const list = await import('./+server.js');
const one = await import('./[id]/+server.js');
const scan = await import('./[id]/scan/+server.js');
const imagesList = await import('./[id]/images/+server.js');
const slide = await import('../photo/slideshow/+server.js');
const hide = await import('../photo/[id]/hide/+server.js');

/** Parsed JSON response; loosely typed on purpose in tests. */
type Loose = ReturnType<typeof JSON.parse>;
const adult = { id: 'a', name: 'A' };
const run = async (
	fn: unknown,
	init: { adult?: boolean; body?: unknown; params?: object; qs?: string } = {}
) => {
	const event = {
		locals: { adult: init.adult === false ? null : adult },
		params: init.params ?? {},
		url: new URL(`http://hub/x${init.qs ?? ''}`),
		request: new Request('http://hub/x', {
			method: 'POST',
			body: init.body === undefined ? undefined : JSON.stringify(init.body)
		})
	};
	try {
		const res = (await (fn as (e: unknown) => unknown)(event)) as Response;
		return { status: res.status, body: (await res.json()) as Loose };
	} catch (e) {
		return { status: (e as { status: number }).status, body: null as Loose };
	}
};

beforeAll(async () => {
	db = openDb(':memory:');
	const jpg = await syntheticJpeg(60, 40);
	for (const f of ['a/1.jpg', 'a/2.jpg', 'b/3.jpg']) {
		mkdirSync(join(root, f, '..'), { recursive: true });
		writeFileSync(join(root, f), jpg);
	}
	mkdirSync(join(base, 'elsewhere'));
});
afterAll(() => rmSync(base, { recursive: true, force: true }));

describe('photo-sources API', () => {
	it('requires an adult', async () => {
		const p = { params: { id: 'x' }, adult: false };
		expect((await run(list.GET, { adult: false })).status).toBe(401);
		expect((await run(list.POST, { adult: false, body: {} })).status).toBe(401);
		expect((await run(one.PATCH, p)).status).toBe(401);
		expect((await run(one.DELETE, p)).status).toBe(401);
		expect((await run(scan.POST, p)).status).toBe(401);
		expect((await run(imagesList.GET, p)).status).toBe(401);
		expect((await run(hide.POST, p)).status).toBe(401);
	});

	it('rejects bad input and traversal', async () => {
		const post = (body: unknown) => run(list.POST, { body });
		expect((await post({ kind: 'smb', label: 'x', root })).status).toBe(400);
		expect((await post({ kind: 'folder', root })).status).toBe(400);
		expect((await post({ kind: 'folder', label: 'x', root: join(base, 'elsewhere') })).status).toBe(
			400
		);
		expect(
			(await post({ kind: 'folder', label: 'x', root: `${root}/../../elsewhere` })).status
		).toBe(400);
		expect((await post({ kind: 'folder', label: 'x', root: '/etc' })).status).toBe(400);
		expect((await post({ kind: 'folder', label: 'x', root: 'photos' })).status).toBe(400);
		expect((await run(list.GET)).body).toEqual([]);
	});

	let id = '';
	it('adds a source and reports albums', async () => {
		const res = await run(list.POST, { body: { kind: 'folder', label: 'Fam', root } });
		expect(res.status).toBe(201);
		id = res.body.id;
		expect(res.body.albums).toEqual([
			{ name: 'a', count: 2, selected: true },
			{ name: 'b', count: 1, selected: true }
		]);
		expect(res.body.lastScan.count).toBe(3);
		expect((await run(list.GET)).body).toHaveLength(1);
	});

	it('selects albums, feeds the slideshow, hides and unhides', async () => {
		const patch = await run(one.PATCH, { params: { id }, body: { label: 'Home', albums: ['a'] } });
		expect(patch.body.label).toBe('Home');
		expect(patch.body.albums.map((a: { selected: boolean }) => a.selected)).toEqual([true, false]);
		expect((await run(one.PATCH, { params: { id }, body: { albums: [1] } })).status).toBe(400);
		expect((await run(one.PATCH, { params: { id: 'zz' }, body: {} })).status).toBe(404);

		const show = await run(slide.GET, { adult: false, qs: '?limit=10&seed=q' });
		expect(show.body).toHaveLength(2);
		expect(Object.keys(show.body[0]).sort()).toEqual(['album', 'h', 'id', 'takenAt', 'w']);
		expect((await run(slide.GET, { adult: false, qs: '?limit=1' })).body).toHaveLength(1);

		const grid = await run(imagesList.GET, { params: { id }, qs: '?limit=2' });
		expect(grid.body).toHaveLength(2);
		const target = show.body[0].id;
		expect((await run(hide.POST, { params: { id: target } })).body.hidden).toBe(true);
		expect((await run(slide.GET, { adult: false })).body).toHaveLength(1);
		expect(
			(await run(hide.POST, { params: { id: target }, body: { hidden: false } })).body.hidden
		).toBe(false);
		expect((await run(hide.POST, { params: { id: 'nope' } })).status).toBe(404);
	});

	it('scans on demand and deletes without touching files', async () => {
		writeFileSync(join(root, 'a/4.jpg'), await syntheticJpeg(10, 10));
		const res = await run(scan.POST, { params: { id } });
		expect(res.body.added).toBe(1);
		expect((await run(scan.POST, { params: { id: 'zz' } })).status).toBe(404);
		expect((await run(one.DELETE, { params: { id } })).body.deleted).toBe(true);
		expect((await run(one.DELETE, { params: { id } })).status).toBe(404);
		expect(db.select().from(schema.photos).all()).toHaveLength(0);
		expect(await fileExists(join(root, 'a/1.jpg'))).toBe(true);
	});

	it('reports a scan of a vanished root as 400', async () => {
		db.insert(schema.photoSources)
			.values({
				id: 'v',
				kind: 'folder',
				label: 'v',
				config: JSON.stringify({ root: join(base, 'gone') })
			})
			.run();
		expect((await run(scan.POST, { params: { id: 'v' } })).status).toBe(400);
	});
});

async function fileExists(p: string) {
	const { access } = await import('node:fs/promises');
	return access(p).then(
		() => true,
		() => false
	);
}
