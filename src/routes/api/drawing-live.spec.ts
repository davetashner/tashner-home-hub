import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'hub-drawing-live-api-'));

const open = await import('./drawing-live/+server.js');
const snap = await import('./drawing-live/[id]/+server.js');
const evs = await import('./drawing-live/[id]/events/+server.js');
const dom = await import('#lib/server/domain/drawing-live.js');
const hub = await import('#lib/server/domain/events.js');
const { encodeLiveItem } = await import('#lib/domain/drawing-live.js');

const call = async (h: unknown, ev: Record<string, unknown>) =>
	(h as (e: unknown) => Promise<Response> | Response)({ locals: { adult: null }, ...ev });
const post = (id: string, body: unknown, raw?: string) =>
	call(evs.POST, {
		params: { id },
		request: new Request('http://example.com/x', {
			method: 'POST',
			body: raw ?? JSON.stringify(body)
		})
	});
const item = (x: number) =>
	encodeLiveItem(
		{
			tool: 'pen',
			color: 'draw-red',
			points: [
				{ x, y: 1, w: 3 },
				{ x: x + 2, y: 4, w: 3 }
			]
		},
		{ w: 100, h: 100 }
	);
const newId = async () => (await (await call(open.POST, {})).json()).id as string;

beforeEach(() => dom.resetSessions());

describe('live drawing API', () => {
	it('opens a session, orders two devices, relays over SSE and snapshots for a late joiner', async () => {
		const id = await newId();
		const seen: string[] = [];
		const unsub = hub.subscribe(['drawing'], (e) => seen.push(e.data.entry))!;
		const a = await (
			await post(id, { author: 'wall', event: { type: 'add', item: item(1) } })
		).json();
		const b = await (
			await post(id, { author: 'ipad', event: { type: 'add', item: item(2) } })
		).json();
		expect([a.seq, b.seq]).toEqual([1, 2]);
		await post(id, { author: 'wall', event: { type: 'undo' } });
		unsub();
		expect(seen.map((s) => JSON.parse(s).seq)).toEqual([1, 2, 3]);
		const s = await (await call(snap.GET, { params: { id } })).json();
		expect(s.seq).toBe(3);
		expect(s.items.map((i: { author: string }) => i.author)).toEqual(['ipad']);
	});

	it('404s for an unknown session', async () => {
		await expect(call(snap.GET, { params: { id: 'nope' } })).rejects.toMatchObject({ status: 404 });
		await expect(post('nope', { author: 'a', event: { type: 'undo' } })).rejects.toMatchObject({
			status: 404
		});
	});

	it('refuses bad events and authors with 400, and an empty undo with 404', async () => {
		const id = await newId();
		await expect(
			post(id, { author: 'a', event: { type: 'add', item: 'x' } })
		).rejects.toMatchObject({
			status: 400
		});
		await expect(post(id, { author: '', event: { type: 'undo' } })).rejects.toMatchObject({
			status: 400
		});
		await expect(post(id, null, 'not json')).rejects.toMatchObject({ status: 400 });
		await expect(post(id, [1])).rejects.toMatchObject({ status: 400 });
		await expect(post(id, { author: 'a', event: { type: 'undo' } })).rejects.toMatchObject({
			status: 404
		});
	});

	it('enforces the body size limit with 413', async () => {
		const id = await newId();
		const big = JSON.stringify({ author: 'a', pad: 'x'.repeat(dom.MAX_EVENT_BODY + 1) });
		await expect(post(id, null, big)).rejects.toMatchObject({ status: 413 });
		const req = new Request('http://example.com/x', {
			method: 'POST',
			body: '{}',
			headers: { 'content-length': String(dom.MAX_EVENT_BODY + 1) }
		});
		await expect(call(evs.POST, { params: { id }, request: req })).rejects.toMatchObject({
			status: 413
		});
	});

	it('caps open sessions and expires idle ones', async () => {
		const t0 = Date.now();
		const ids = Array.from({ length: dom.MAX_SESSIONS }, () => dom.openSession(t0).id);
		await expect(call(open.POST, {})).rejects.toMatchObject({ status: 409 });
		expect(() => dom.snapshotSession(ids[0], t0 + dom.SESSION_IDLE_MS - 1)).not.toThrow();
		const later = t0 + dom.SESSION_IDLE_MS * 3;
		expect(() => dom.snapshotSession(ids[1], later)).toThrow(/ended/);
		expect(() => dom.openSession(later)).not.toThrow();
	});

	it('refuses an add once the board is full', async () => {
		const id = await newId();
		const { SAVED_MAX_ITEMS } = await import('#lib/domain/drawing-save.js');
		const one = JSON.stringify({ type: 'add', item: item(1) });
		for (let i = 0; i < SAVED_MAX_ITEMS; i++) dom.postEvent(id, 'a', JSON.parse(one));
		await expect(post(id, { author: 'a', event: JSON.parse(one) })).rejects.toMatchObject({
			status: 409
		});
	});
});
