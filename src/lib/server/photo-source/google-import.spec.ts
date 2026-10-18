import { mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { openDb, schema, type Db } from '../db/index.js';
import {
	cancelImport,
	currentImport,
	resetForTests,
	setTokenForTests,
	settled,
	startImport,
	startPickerConsent
} from './google-import.js';

const base = mkdtempSync(join(tmpdir(), 'hub-gimport-'));
const root = join(base, 'allowed', 'lib');
process.env.HUB_PHOTO_ROOTS = join(base, 'allowed');
process.env.HUB_GOOGLE_CLIENT_ID = 'cid';
process.env.HUB_GOOGLE_CLIENT_SECRET = 'secret';
let db: Db;

const item = (id: string, over: Record<string, unknown> = {}) => ({
	id,
	type: 'PHOTO',
	mediaFile: { baseUrl: `https://dl.test/${id}`, mimeType: 'image/jpeg', filename: 'IMG.jpg' },
	...over
});

/** A stub of Google: the pick is "set" on the second poll. */
function stubGoogle(items: unknown[], opts: { failDownload?: string } = {}) {
	const calls: { method: string; url: string; auth: string | null }[] = [];
	let polls = 0;
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init: RequestInit = {}) => {
			const method = init.method ?? 'GET';
			const h = new Headers(init.headers);
			calls.push({ method, url, auth: h.get('authorization') });
			const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
			if (url.endsWith('/v1/sessions') && method === 'POST')
				return json({
					id: 'sess1',
					pickerUri: 'https://photos.test/pick',
					pollingConfig: { pollInterval: '1s', timeoutIn: '60s' }
				});
			if (url.endsWith('/v1/sessions/sess1') && method === 'GET')
				return json({ id: 'sess1', mediaItemsSet: ++polls >= 2 });
			if (url.endsWith('/v1/sessions/sess1') && method === 'DELETE') return json({});
			if (url.includes('/v1/mediaItems')) return json({ mediaItems: items });
			if (url.startsWith('https://dl.test/')) {
				if (opts.failDownload && url.includes(opts.failDownload))
					return new Response('', { status: 500 });
				return new Response(Buffer.from(`bytes:${url}`));
			}
			return json({}, 404);
		})
	);
	return calls;
}

beforeAll(() => {
	mkdirSync(root, { recursive: true });
	db = openDb(':memory:');
	db.insert(schema.photoSources)
		.values({
			id: 'src1',
			kind: 'folder',
			label: 'Lib',
			config: JSON.stringify({ root, albums: [], recursive: true })
		})
		.run();
});

afterEach(() => {
	vi.unstubAllGlobals();
	resetForTests();
});

const sleep = async () => {};

describe('Google Photos picker import', () => {
	it('builds a consent URL with only the picker scope', () => {
		const { url } = startPickerConsent();
		expect(new URL(url).searchParams.get('scope')).toBe(
			'https://www.googleapis.com/auth/photospicker.mediaitems.readonly'
		);
	});

	it('refuses without a connection', async () => {
		await expect(startImport(db, { sourceId: 'src1', sleep })).rejects.toThrow('Connect Google');
	});

	it('polls, downloads photos with the bearer token, skips videos, cleans up, rescans', async () => {
		setTokenForTests('tok');
		const calls = stubGoogle([item('a1'), item('b2'), item('v1', { type: 'VIDEO' })]);
		const first = await startImport(db, { sourceId: 'src1', album: 'Beach/../Day', sleep });
		expect(first.status).toBe('waiting');
		expect(first.pickerUri).toBe('https://photos.test/pick');
		await settled();
		const job = currentImport()!;
		expect(job).toMatchObject({
			status: 'done',
			total: 2,
			done: 2,
			skipped: 0,
			album: 'Beach Day'
		});
		expect(readdirSync(join(root, 'Beach Day')).sort()).toEqual(['gp-a1.jpg', 'gp-b2.jpg']);
		expect(readFileSync(join(root, 'Beach Day', 'gp-a1.jpg'), 'utf8')).toContain('a1');
		const dl = calls.filter((c) => c.url.startsWith('https://dl.test/'));
		expect(dl.map((c) => c.url)).toEqual(['https://dl.test/a1=d', 'https://dl.test/b2=d']);
		expect(dl.every((c) => c.auth === 'Bearer tok')).toBe(true);
		expect(calls.some((c) => c.method === 'DELETE')).toBe(true);
		expect(db.select().from(schema.photos).all()).toHaveLength(2);
	});

	it('is idempotent: files already present are skipped, failures counted', async () => {
		setTokenForTests('tok');
		stubGoogle([item('a1'), item('c3')], { failDownload: 'c3' });
		await startImport(db, { sourceId: 'src1', album: 'Beach Day', sleep });
		await settled();
		expect(currentImport()).toMatchObject({ status: 'done', skipped: 1, done: 0, failed: 1 });
		expect(readdirSync(join(root, 'Beach Day')).sort()).toEqual(['gp-a1.jpg', 'gp-b2.jpg']);
	});

	it('uses a dated default album and never escapes the root', async () => {
		setTokenForTests('tok');
		stubGoogle([item('z9')]);
		await startImport(db, { sourceId: 'src1', album: '../../..', sleep });
		await settled();
		const album = currentImport()!.album;
		expect(album).toMatch(/^Google Photos import \d{4}-\d{2}-\d{2}$/);
		expect(readdirSync(root)).toContain(album);
	});

	it('can be cancelled while waiting and still deletes the session', async () => {
		setTokenForTests('tok');
		const calls = stubGoogle([]);
		await startImport(db, { sourceId: 'src1', sleep });
		cancelImport();
		await settled();
		expect(currentImport()!.status).toBe('cancelled');
		expect(calls.some((c) => c.method === 'DELETE')).toBe(true);
	});

	it('rejects a second import while one is running and unknown folders', async () => {
		setTokenForTests('tok');
		stubGoogle([]);
		await expect(startImport(db, { sourceId: 'nope', sleep })).rejects.toThrow(
			'Unknown photo folder'
		);
		await startImport(db, { sourceId: 'src1', sleep });
		await expect(startImport(db, { sourceId: 'src1', sleep })).rejects.toThrow('already running');
		cancelImport();
		await settled();
	});

	it('reports an error when Google denies access', async () => {
		setTokenForTests('tok');
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('{}', { status: 403 }))
		);
		await expect(startImport(db, { sourceId: 'src1', sleep })).rejects.toThrow('Photos Picker API');
	});
});
