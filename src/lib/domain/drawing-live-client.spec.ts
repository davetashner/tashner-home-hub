import { describe, expect, it } from 'vitest';
import {
	createSender,
	diffLocal,
	entryFor,
	feed,
	inviteFrom,
	joinRemote,
	newAuthor,
	remoteItems,
	resync,
	type SendResult
} from './drawing-live-client.js';
import { emptyBoard, encodeLiveItem, type LiveEntry, type LiveEvent } from './drawing-live.js';

const json = (x: number) =>
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
const add = (seq: number, author: string): LiveEntry => ({
	seq,
	author,
	type: 'add',
	item: json(seq)
});

describe('remote board', () => {
	it('applies entries in order and holds back ones that skip ahead', () => {
		let r = joinRemote('me', emptyBoard());
		let f = feed(r, [add(2, 'ipad')]);
		expect(f.gap).toBe(true);
		expect(f.remote.board.seq).toBe(0);
		f = feed(f.remote, [add(1, 'ipad'), add(1, 'ipad')]);
		expect(f.gap).toBe(false);
		expect(f.remote.board.items.map((i) => i.seq)).toEqual([1, 2]);
		r = feed(f.remote, [add(1, 'ipad')]).remote;
		expect(r.board.seq).toBe(2);
	});

	it('shows other people, restored own items, and skips own live adds', () => {
		const snap = { seq: 1, items: [{ seq: 1, author: 'me', item: json(1) }] };
		let r = joinRemote('me', snap);
		r = feed(r, [add(2, 'me'), add(3, 'ipad')]).remote;
		expect(remoteItems(r).map((i) => i.seq)).toEqual([1, 3]);
	});

	it('resync takes a newer snapshot, then replays what was buffered', () => {
		let r = joinRemote('me', emptyBoard());
		r = feed(r, [add(3, 'ipad')]).remote;
		const snap = { seq: 2, items: [{ seq: 1, author: 'ipad', item: json(1) }] };
		r = resync(r, snap);
		expect(r.board.seq).toBe(3);
		expect(r.buffer).toEqual([]);
		expect(resync(r, { seq: 1, items: [] })).toBe(r);
	});
});

describe('diffLocal', () => {
	const a = { n: 'a' };
	const b = { n: 'b' };
	const c = { n: 'c' };
	it('sends new strokes and undoes dropped ones', () => {
		expect(diffLocal([], [a, b], false)).toEqual({ undos: 0, adds: [a, b], sent: [a, b] });
		expect(diffLocal([a, b], [a], false)).toEqual({ undos: 1, adds: [], sent: [a] });
		expect(diffLocal([a, b], [a, c], false)).toEqual({ undos: 1, adds: [c], sent: [a, c] });
	});
	it('holds back the shape still being edited', () => {
		expect(diffLocal([a], [a, b], true)).toEqual({ undos: 0, adds: [], sent: [a] });
		expect(diffLocal([], [b], true).sent).toEqual([]);
	});
});

describe('frames', () => {
	it('makes a random author id', () => {
		expect(newAuthor()).toMatch(/^d[0-9a-z]{12}$/);
		expect(newAuthor(() => 0)).toBe('d000000000000');
	});
	it('reads an invitation only for a well-formed session id', () => {
		expect(inviteFrom({ session: 'abcdef01', started: '1' })).toBe('abcdef01');
		expect(inviteFrom({ session: 'abcdef01' })).toBeNull();
		expect(inviteFrom({ session: '../x', started: '1' })).toBeNull();
	});
	it('reads an entry for the right session only', () => {
		const e = add(1, 'x');
		const data = { session: 's1', entry: JSON.stringify(e) };
		expect(entryFor(data, 's1')).toEqual(e);
		expect(entryFor(data, 's2')).toBeNull();
		expect(entryFor({ session: 's1', entry: 'nope' }, 's1')).toBeNull();
	});
});

describe('sender', () => {
	const entry = (seq: number): LiveEntry => ({ seq, author: 'me', type: 'undo', removed: 1 });
	const tick = () => new Promise((r) => setTimeout(r, 0));

	it('sends in order and reports each entry', async () => {
		const sent: LiveEvent[] = [];
		const got: number[] = [];
		const s = createSender({
			send: async (e) => (sent.push(e), { ok: true, entry: entry(sent.length) }),
			onEntry: (e) => got.push(e.seq)
		});
		s.enqueue({ type: 'undo' });
		s.enqueue({ type: 'add', item: json(1) });
		await tick();
		expect(sent.map((e) => e.type)).toEqual(['undo', 'add']);
		expect(got).toEqual([1, 2]);
	});

	it('retries a network failure, flips status and drops refused events', async () => {
		const results: SendResult[] = [
			{ ok: false, retry: true },
			{ ok: false, retry: false },
			{ ok: true, entry: entry(7) }
		];
		const status: boolean[] = [];
		const dropped: LiveEvent[] = [];
		const got: number[] = [];
		const waits: number[] = [];
		const s = createSender({
			send: async () => results.shift()!,
			onEntry: (e) => got.push(e.seq),
			onDrop: (e) => dropped.push(e),
			onStatus: (u) => status.push(u),
			wait: async (ms) => void waits.push(ms)
		});
		s.enqueue({ type: 'undo' });
		s.enqueue({ type: 'undo' });
		await tick();
		expect(waits).toEqual([1000]);
		expect(dropped).toHaveLength(1);
		expect(got).toEqual([7]);
		expect(status).toEqual([false, true]);
	});

	it('stop empties the queue and kick wakes a waiting retry', async () => {
		let calls = 0;
		const s = createSender({
			send: async () => (calls++ < 2 ? { ok: false, retry: true } : { ok: true, entry: entry(1) }),
			onEntry: () => {}
		});
		s.enqueue({ type: 'undo' });
		await tick();
		expect(calls).toBe(1);
		s.kick();
		await tick();
		expect(calls).toBe(2);
		s.stop();
		s.kick();
		await tick();
		expect(calls).toBe(2);
	});
});
