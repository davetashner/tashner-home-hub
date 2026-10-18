<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { page } from '$app/state';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import MemberAvatar from '#lib/components/MemberAvatar.svelte';
	import { REWARD_EMOJI } from '#lib/domain/emoji.js';
	import { createLiveChannel } from '#lib/domain/live-events.js';
	import { isMemberColor, type MemberColor } from '#lib/domain/member-colors.js';
	import {
		NOTE_COLORS,
		NOTE_MAX,
		UNTIL_CHOICES,
		cleanNoteBody,
		expiryFor,
		untilLabel,
		visibleNotes,
		withStableKeys,
		type NoteColor,
		type Until
	} from '#lib/domain/notes.js';
	import { isTimeZone, runtimeZone } from '#lib/domain/time-zone.js';

	interface Note {
		id: string;
		/** Stable render key: a posted note keeps its optimistic key after the server id arrives. */
		key: string;
		body: string;
		color: string;
		pinned: boolean;
		createdAt: number;
		expiresAt: number | null;
		authorId: string;
		authorName: string;
		authorColor: string;
		authorAvatar: string | null;
	}
	interface Member {
		id: string;
		name: string;
		color: string;
		avatar: string | null;
	}

	const POLL_MS = 60_000;
	// Full class names so Tailwind can see them.
	const paper: Record<NoteColor, string> = {
		'note-yellow': 'bg-note-yellow',
		'note-pink': 'bg-note-pink',
		'note-blue': 'bg-note-blue',
		'note-green': 'bg-note-green'
	};
	const colorLabel: Record<NoteColor, string> = {
		'note-yellow': 'Yellow',
		'note-pink': 'Pink',
		'note-blue': 'Blue',
		'note-green': 'Green'
	};
	const memberColor = (c: string): MemberColor => (isMemberColor(c) ? c : 'member-1');

	let all = $state<Note[]>([]);
	let people = $state<Member[]>([]);
	let now = $state(Date.now());
	let pending = 0;
	let composing = $state(false);
	let showEmoji = $state(false);
	let authorId = $state('');
	let body = $state('');
	let color = $state<NoteColor>('note-yellow');
	let until = $state<Until | null>(null);
	let tempSeq = 0;
	// server id -> the temp key the card was first rendered under.
	const keys = new SvelteMap<string, string>();
	// Temp ids dismissed before the POST returned; deleted once the server id is known.
	const dismissedEarly = new SvelteSet<string>();

	const zone = $derived(isTimeZone(page.data.timeZone) ? page.data.timeZone : runtimeZone());
	const adult = $derived(page.data.adult === true);
	const shown = $derived(visibleNotes(all, now));
	const clean = $derived(cleanNoteBody(body));
	const room = $derived(NOTE_MAX - [...body].length);

	async function refresh() {
		try {
			const r = await fetch('/api/notes');
			if (r.ok && pending === 0)
				all = withStableKeys((await r.json()) as Omit<Note, 'key'>[], keys);
		} catch {
			// Offline: keep what is on screen.
		}
	}

	async function mutate(send: () => Promise<Response>, onOk?: (r: Response) => Promise<void>) {
		pending++;
		try {
			const r = await send();
			if (!r.ok) throw new Error(String(r.status));
			await onOk?.(r);
		} catch {
			// Roll back by reloading the truth once nothing else is in flight.
		} finally {
			pending--;
			void refresh();
		}
	}

	function post(e: SubmitEvent) {
		e.preventDefault();
		const who = people.find((p) => p.id === authorId);
		if (!who || clean === null) return;
		const t = Date.now();
		const payload = { authorId: who.id, body: clean, color, until };
		const tempId = `temp-${++tempSeq}`;
		all = [
			...all,
			{
				id: tempId,
				key: tempId,
				body: clean,
				color,
				pinned: false,
				createdAt: t,
				expiresAt: expiryFor(until, t, zone),
				authorId: who.id,
				authorName: who.name,
				authorColor: who.color,
				authorAvatar: who.avatar
			}
		];
		body = '';
		until = null;
		composing = false;
		showEmoji = false;
		void mutate(
			() =>
				fetch('/api/notes', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(payload)
				}),
			async (r) => {
				const { id } = (await r.json()) as { id: string };
				keys.set(id, tempId);
				if (dismissedEarly.delete(tempId)) {
					// Dismissed while still optimistic: delete the real row now that it has an id.
					await fetch(`/api/notes/${id}`, {
						method: 'DELETE',
						headers: { 'content-type': 'application/json' },
						body: '{}'
					});
				} else {
					all = all.map((x) => (x.id === tempId ? { ...x, id } : x));
				}
			}
		);
	}

	function dismiss(n: Note) {
		all = all.filter((x) => x.id !== n.id);
		if (n.id.startsWith('temp-')) {
			dismissedEarly.add(n.id);
			return;
		}
		void mutate(() =>
			fetch(`/api/notes/${n.id}`, {
				method: 'DELETE',
				headers: { 'content-type': 'application/json' },
				body: '{}'
			})
		);
	}

	function togglePin(n: Note) {
		if (n.id.startsWith('temp-')) return;
		all = all.map((x) => (x.id === n.id ? { ...x, pinned: !n.pinned } : x));
		void mutate(() =>
			fetch(`/api/notes/${n.id}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ pinned: !n.pinned })
			})
		);
	}

	function addEmoji(emoji: string) {
		if ([...body].length + [...emoji].length <= NOTE_MAX) body += emoji;
	}

	onMount(() => {
		void refresh();
		fetch('/api/members')
			.then((r) => (r.ok ? r.json() : []))
			.then((list: Member[]) => (people = list))
			.catch(() => {});
		const channel = createLiveChannel({
			url: '/api/events',
			topics: ['notes'],
			create: (url) => new EventSource(url),
			onEvent: () => void refresh(),
			// Events missed while the stream was down: catch up on (re)connect.
			onOpen: () => void refresh()
		});
		channel.start();
		// Expiry is checked locally each minute; the slow poll is the fallback if SSE is down.
		const tick = setInterval(() => (now = Date.now()), 30_000);
		const poll = setInterval(() => void refresh(), POLL_MS);
		const onVisible = () => {
			if (document.visibilityState === 'visible') {
				channel.resume();
				now = Date.now();
				void refresh();
			}
		};
		document.addEventListener('visibilitychange', onVisible);
		return () => {
			channel.stop();
			clearInterval(tick);
			clearInterval(poll);
			document.removeEventListener('visibilitychange', onVisible);
		};
	});

	const chip =
		'flex min-h-tap items-center justify-center rounded-control border-2 px-4 text-body font-extrabold transition-transform duration-75 active:scale-95';
</script>

<section aria-label="Family notes" data-testid="home-notes" class="flex flex-col gap-4 short:gap-2">
	<div class="flex items-center justify-between gap-4">
		<h2 class="text-lead font-extrabold short:text-body">Notes</h2>
		{#if !composing}
			<Button variant="secondary" onclick={() => (composing = true)} data-testid="note-add">
				Add a note
			</Button>
		{/if}
	</div>

	{#if composing}
		<Card class="flex flex-col gap-4 short:gap-2" elevation="float">
			<form class="contents" onsubmit={post} data-testid="note-form">
				<div
					class="flex flex-wrap gap-3"
					role="group"
					aria-label="Who is posting?"
					data-testid="note-authors"
				>
					{#each people as p (p.id)}
						<button
							type="button"
							class="flex min-h-tap-kid items-center gap-3 rounded-control border-2 px-3 text-body font-extrabold {authorId ===
							p.id
								? 'border-accent bg-accent-soft'
								: 'border-line bg-surface'}"
							aria-pressed={authorId === p.id}
							data-testid="note-author"
							onclick={() => (authorId = p.id)}
						>
							<MemberAvatar
								name={p.name}
								color={memberColor(p.color)}
								avatar={p.avatar}
								size="kid"
							/>
							<span>{p.name}</span>
						</button>
					{/each}
				</div>
				<label class="flex flex-col gap-2">
					<span class="text-caption text-ink-muted">Note</span>
					<textarea
						class="min-h-tap-kid w-full resize-none rounded-control border-2 border-line bg-surface p-4 text-body text-ink"
						rows="3"
						maxlength={NOTE_MAX}
						bind:value={body}
						data-testid="note-body"></textarea>
					<span class="text-caption text-ink-muted" data-testid="note-left">{room} left</span>
				</label>
				<div class="flex flex-wrap items-center gap-3">
					<button
						type="button"
						class="{chip} border-line bg-surface"
						aria-expanded={showEmoji}
						data-testid="note-emoji-toggle"
						onclick={() => (showEmoji = !showEmoji)}>Emoji</button
					>
					<div class="flex flex-wrap gap-3" role="group" aria-label="Note color">
						{#each NOTE_COLORS as c (c)}
							<button
								type="button"
								class="size-tap rounded-chip border-4 {paper[c]} {color === c
									? 'border-accent'
									: 'border-line'}"
								aria-label={colorLabel[c]}
								aria-pressed={color === c}
								data-testid="note-color"
								data-color={c}
								onclick={() => (color = c)}
							></button>
						{/each}
					</div>
				</div>
				{#if showEmoji}
					<div
						class="flex flex-wrap gap-2"
						role="group"
						aria-label="Emoji"
						data-testid="note-emoji-grid"
					>
						{#each REWARD_EMOJI as c (c.emoji)}
							<button
								type="button"
								class="flex size-tap items-center justify-center rounded-control border-2 border-line bg-surface text-title active:scale-95"
								aria-label={c.label}
								data-testid="note-emoji"
								onclick={() => addEmoji(c.emoji)}>{c.emoji}</button
							>
						{/each}
					</div>
				{/if}
				<div class="flex flex-wrap items-center gap-3" role="group" aria-label="Keep until">
					<span class="text-caption text-ink-muted">Keep until</span>
					<button
						type="button"
						class="{chip} {until === null
							? 'border-accent bg-accent-soft'
							: 'border-line bg-surface'}"
						aria-pressed={until === null}
						data-testid="note-until"
						data-until="none"
						onclick={() => (until = null)}>Dismissed</button
					>
					{#each UNTIL_CHOICES as u (u.id)}
						<button
							type="button"
							class="{chip} {until === u.id
								? 'border-accent bg-accent-soft'
								: 'border-line bg-surface'}"
							aria-pressed={until === u.id}
							data-testid="note-until"
							data-until={u.id}
							onclick={() => (until = u.id)}>{u.label}</button
						>
					{/each}
				</div>
				<div class="flex flex-wrap gap-3">
					<Button
						type="submit"
						size="kid"
						disabled={clean === null || authorId === ''}
						data-testid="note-post">Post</Button
					>
					<Button variant="ghost" onclick={() => (composing = false)} data-testid="note-cancel">
						Cancel
					</Button>
				</div>
			</form>
		</Card>
	{/if}

	{#if shown.length > 0}
		<ul class="grid grid-cols-3 gap-8 portrait:grid-cols-1 short:gap-3" data-testid="note-list">
			{#each shown as n (n.key)}
				{@const hint = untilLabel(n.expiresAt, now, zone)}
				<li
					class="flex min-w-0 flex-col gap-3 rounded-card p-6 text-ink shadow-raised short:p-3 {paper[
						n.color as NoteColor
					] ?? 'bg-note-yellow'}"
					data-testid="note"
					data-pinned={n.pinned}
				>
					<p class="text-body [overflow-wrap:anywhere]" data-testid="note-text">{n.body}</p>
					<div class="flex items-center gap-3">
						<MemberAvatar
							name={n.authorName}
							color={memberColor(n.authorColor)}
							avatar={n.authorAvatar}
							size="sm"
						/>
						<span class="min-w-0 flex-1 text-caption">
							<span class="block truncate font-extrabold">{n.authorName}</span>
							{#if hint}<span class="block text-ink-muted">{hint}</span>{/if}
						</span>
						{#if n.pinned && !adult}<span aria-label="Pinned" role="img">📌</span>{/if}
						{#if adult}
							<button
								type="button"
								class="flex size-tap items-center justify-center rounded-control text-title active:scale-95 {n.pinned
									? 'bg-surface-raised'
									: 'opacity-60'}"
								aria-label={n.pinned ? 'Unpin note' : 'Pin note'}
								aria-pressed={n.pinned}
								data-testid="note-pin"
								onclick={() => togglePin(n)}>📌</button
							>
						{/if}
						<button
							type="button"
							class="flex size-tap items-center justify-center rounded-control bg-surface-raised text-lead font-extrabold active:scale-95"
							aria-label="Dismiss note"
							data-testid="note-dismiss"
							onclick={() => dismiss(n)}>✕</button
						>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</section>
