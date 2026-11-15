import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'hub-drawing-live-api-'));

const open = await import('./drawing-live/+server.js');
const snap = await import('./drawing-live/[id]/+server.js');
const evs = await import('./drawing-live/[id]/events/+server.js');
const game = await import('./drawing-live/[id]/game/+server.js');
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
	it('announces a new session to subscribers so other devices can offer to join', async () => {
		const seen: Record<string, string>[] = [];
		const unsub = hub.subscribe(['drawing'], (e) => seen.push(e.data))!;
		const id = await newId();
		unsub();
		expect(seen).toEqual([{ session: id, started: '1' }]);
	});

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

describe('draw and guess (hub-t27j.10)', () => {
	const act = (id: string, body: unknown) =>
		call(game.POST, {
			params: { id },
			request: new Request('http://example.com/x', { method: 'POST', body: JSON.stringify(body) })
		});
	const statusOf = (id: string, body: unknown) =>
		act(id, body).then(
			(r) => r.status,
			(e: { status: number }) => e.status
		);
	const send = async (id: string, author: string, rest: Record<string, unknown>) =>
		(await act(id, { author, ...rest })).json();

	it('only the drawer is told the word, and guesses are checked on the server', async () => {
		const id = await newId();
		const started = await send(id, 'drawerA', { action: 'start' });
		expect(typeof started.word).toBe('string');
		const seen = await send(id, 'guesserB', { action: 'ping' });
		expect(seen.word).toBeUndefined();
		expect(JSON.stringify(seen.game)).not.toContain(`"word"`);
		expect(seen.game.guesser).toBe('guesserB');
		const wrong = seen.game.choices.findIndex((c: string) => c !== started.word);
		expect((await send(id, 'guesserB', { action: 'guess', index: wrong })).result).toBe('wrong');
		const right = await send(id, 'guesserB', {
			action: 'guess',
			index: seen.game.choices.indexOf(started.word)
		});
		expect(right.result).toBe('right');
		expect(right.game.word).toBe(started.word);
		const next = await send(id, 'guesserB', { action: 'start' });
		expect(next.game.drawer).toBe('guesserB');
		expect(typeof next.word).toBe('string');
	});

	it('relays public state on the drawing topic and ends on leave', async () => {
		const id = await newId();
		const got: Record<string, string>[] = [];
		const off = hub.subscribe(['drawing'], (e: { data: Record<string, string> }) =>
			got.push(e.data)
		);
		await send(id, 'a', { action: 'start' });
		await send(id, 'a', { action: 'leave' });
		off?.();
		const games = got.filter((d) => d.session === id && 'game' in d).map((d) => JSON.parse(d.game));
		expect(games[0].status).toBe('drawing');
		expect(games[0].word).toBeUndefined();
		expect(games[1]).toBeNull();
		expect((await send(id, 'b', { action: 'ping' })).game).toBeNull();
	});

	it('drops the round when a player goes quiet', () => {
		const id = dom.openSession(0).id;
		dom.gameAction(id, 'a', { action: 'start' }, 0);
		dom.gameAction(id, 'b', { action: 'ping' }, 1000);
		expect(dom.gameAction(id, 'a', { action: 'ping' }, 5000).game).not.toBeNull();
		expect(dom.gameAction(id, 'a', { action: 'ping' }, 12_000).game).toBeNull();
	});

	it('validates input', async () => {
		const id = await newId();
		expect(await statusOf(id, { author: 'a', action: 'nope' })).toBe(400);
		expect(await statusOf(id, { action: 'start' })).toBe(400);
		expect(await statusOf('deadbeef', { author: 'a', action: 'start' })).toBe(404);
		expect(await statusOf(id, [1])).toBe(400);
		expect(await statusOf(id, 'nope')).toBe(400);
		expect((await send(id, 'a', { action: 'guess', index: 0 })).game).toBeNull();
	});
});
