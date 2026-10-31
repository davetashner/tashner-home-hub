<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { createLiveChannel } from '#lib/domain/live-events.js';
	import {
		createSender,
		diffLocal,
		entryFor,
		feed,
		joinRemote,
		newAuthor,
		remoteItems,
		resync,
		type Remote,
		type SendResult
	} from '#lib/domain/drawing-live-client.js';
	import {
		encodeLiveItem,
		fromSnapshot,
		type LiveBoard,
		type LiveEntry,
		type LiveEvent
	} from '#lib/domain/drawing-live.js';
	import { loadDrawing, type Size } from '#lib/domain/drawing-save.js';
	import type { DrawItem } from '#lib/domain/drawing.js';

	/**
	 * Live shared board (hub-cn7.30): the sync with a session; `LiveChips` has the buttons.
	 * The sheet keeps drawing locally and calls `sync` when its strokes change; remote ink comes
	 * back through `items()`, which the sheet paints under its own strokes.
	 */
	interface Props {
		join?: string;
		size: () => Size;
		dpr: () => number;
		onchange: () => void;
		onleave: (items: DrawItem[]) => void;
		/** A short message for the sheet's status line. */
		onnote: (message: string) => void;
		status: { active: boolean; online: boolean; busy: boolean };
	}
	let { join, size, dpr, onchange, onleave, onnote, status }: Props = $props();

	const JSON_HEADERS = { 'content-type': 'application/json' };

	let session = '';
	let me = '';
	let remote: Remote | null = null;
	let sent: DrawItem[] = [];
	let sender: ReturnType<typeof createSender> | null = null;
	let channel: ReturnType<typeof createLiveChannel> | null = null;
	let destroyed = false;
	let gapTimer: ReturnType<typeof setTimeout> | undefined;
	let cache: Record<number, DrawItem[]> = {};
	let cacheSize = '';

	/** Remote ink for the canvas, decoded for its current size. */
	export function items(): DrawItem[] {
		if (!remote) return [];
		const s = size();
		const key = `${s.w}x${s.h}`;
		if (key !== cacheSize) {
			cache = {};
			cacheSize = key;
		}
		const out: DrawItem[] = [];
		for (const it of remoteItems(remote)) {
			let d = cache[it.seq];
			if (!d) {
				d = loadDrawing(it.item, s) ?? [];
				cache[it.seq] = d;
			}
			out.push(...d);
		}
		return out;
	}

	/** The sheet's strokes changed: send what is new, undo what was dropped. */
	export function sync(strokes: readonly DrawItem[], holdLast: boolean) {
		if (!status.active || !sender) return;
		const d = diffLocal(sent, strokes, holdLast);
		sent = d.sent;
		for (let i = 0; i < d.undos; i++) sender.enqueue({ type: 'undo' });
		for (const item of d.adds)
			sender.enqueue({ type: 'add', item: encodeLiveItem(item, size(), dpr()) });
	}

	async function post(event: LiveEvent): Promise<SendResult> {
		try {
			const res = await fetch(`/api/drawing-live/${session}/events`, {
				method: 'POST',
				headers: JSON_HEADERS,
				body: JSON.stringify({ author: me, event })
			});
			if (res.ok) return { ok: true, entry: await res.json() };
			// A 404 on an add means the session ended: nothing will ever accept it.
			if (res.status === 404 && event.type === 'add') end(ENDED);
			return { ok: false, retry: res.status >= 500 };
		} catch {
			return { ok: false, retry: true };
		}
	}

	function apply(entries: (LiveEntry | null)[]) {
		if (!remote) return;
		const r = feed(
			remote,
			entries.filter((e) => e !== null)
		);
		remote = r.remote;
		if (!destroyed) onchange();
		clearTimeout(gapTimer);
		// An entry is missing: it normally arrives within a moment; if not, refetch the board.
		if (r.gap) gapTimer = setTimeout(() => void refetch(), 1500);
	}

	const ENDED = 'That drawing session has ended.';

	/** The session's board, null when it has ended; throws when it cannot be reached. */
	async function snapshot(id: string): Promise<LiveBoard | null> {
		const res = await fetch(`/api/drawing-live/${id}`);
		if (res.status === 404) return null;
		const board = res.ok ? fromSnapshot(await res.json()) : null;
		if (!board) throw new Error('snapshot');
		return board;
	}

	async function refetch() {
		try {
			const s = await snapshot(session);
			if (!s) return end(ENDED);
			if (!remote) return;
			remote = resync(remote, s);
			onchange();
		} catch {
			// Offline: the next reconnect tries again.
		}
	}

	function connect(id: string, board: LiveBoard) {
		session = id;
		me = newAuthor(); // per session: this device's items are its own to undo
		remote = joinRemote(me, board);
		sent = [];
		cache = {};
		sender = createSender({
			send: post,
			onEntry: (e) => apply([e]),
			onDrop: () => onnote('The shared board is full.'),
			onStatus: (up) => {
				status.online = up;
				// The sheet is gone and the network is too: stop retrying.
				if (destroyed && !up) sender?.stop();
			}
		});
		channel = createLiveChannel({
			url: '/api/events',
			topics: ['drawing'],
			create: (url) => new EventSource(url),
			onEvent: (_t, data) => apply([entryFor(data, session)]),
			onStatus: (up) => (status.online = up),
			onOpen: () => {
				void refetch();
				sender?.kick();
			}
		});
		channel.start();
		status.active = true;
		onnote('');
		onchange();
	}

	export function end(message = '') {
		const keep = items();
		clearTimeout(gapTimer);
		channel?.stop();
		sender?.stop();
		channel = sender = null;
		remote = null;
		sent = [];
		status.active = false;
		status.online = true;
		onnote(message);
		onleave(keep);
	}

	export async function start() {
		status.busy = true;
		onnote('');
		try {
			const res = await fetch('/api/drawing-live', {
				method: 'POST',
				headers: JSON_HEADERS,
				body: '{}'
			});
			if (!res.ok) throw new Error('open');
			const { id } = (await res.json()) as { id: string };
			connect(id, { seq: 0, items: [] });
		} catch {
			onnote('Could not start sharing.');
		}
		status.busy = false;
	}

	async function joinSession(id: string) {
		status.busy = true;
		try {
			const s = await snapshot(id);
			if (s) connect(id, s);
			else onnote(ENDED);
		} catch {
			onnote('Could not join the shared drawing.');
		}
		status.busy = false;
	}

	onMount(() => {
		if (join) void joinSession(join);
	});
	onDestroy(() => {
		destroyed = true;
		clearTimeout(gapTimer);
		channel?.stop();
	});
</script>
