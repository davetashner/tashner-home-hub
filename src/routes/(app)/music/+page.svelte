<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import Button from '#lib/components/ui/Button.svelte';
	import Icon from '#lib/components/shell/Icon.svelte';

	interface Playlist {
		id: string;
		name: string;
		cover: string | null;
		tracks: number;
	}
	interface MusicState {
		connected: boolean;
		online: boolean;
		isPlaying: boolean;
		track: string | null;
		artist: string | null;
		playlist: { id: string; name: string } | null;
		volume: number | null;
		volumeCap: number;
		timerRemainingSec: number | null;
	}

	const POLL_MS = 5000;
	/** After a tap, ignore polls briefly so the optimistic view is not flicked back. */
	const HOLD_MS = 2500;
	const STEP = 10;
	const TINTS = [
		'bg-member-1',
		'bg-member-2',
		'bg-member-3',
		'bg-member-4',
		'bg-member-5',
		'bg-member-6'
	];

	let playlists = $state<Playlist[]>([]);
	let loaded = $state(false);
	let music = $state<MusicState | null>(null);
	let selectedId = $state<string | null>(null);
	let starting = $state(false);
	let playing = $state(false);
	let volume = $state(0);
	let asleep = $state(false);
	let failed = $state(false);
	let retryId: string | null = null;
	let holdUntil = 0;
	let broken = $state<Record<string, true>>({});

	const cap = $derived(music?.volumeCap ?? 70);
	const selected = $derived(playlists.find((p) => p.id === selectedId) ?? null);
	const remaining = $derived(music?.timerRemainingSec ?? null);
	const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

	async function post(path: string, body: unknown = {}): Promise<{ ok: boolean; code?: string }> {
		holdUntil = Date.now() + HOLD_MS;
		try {
			const res = await fetch(`/api/music/${path}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (res.ok) return { ok: true };
			const data = (await res.json().catch(() => ({}))) as { code?: string };
			return { ok: false, code: data.code };
		} catch {
			return { ok: false };
		}
	}

	async function refresh() {
		if (typeof document !== 'undefined' && document.hidden) return;
		try {
			const res = await fetch('/api/music/state');
			if (!res.ok) return;
			const s = (await res.json()) as MusicState;
			music = s;
			if (Date.now() < holdUntil || starting) return;
			playing = s.isPlaying;
			if (s.volume !== null) volume = s.volume;
			if (s.playlist) selectedId = s.playlist.id;
			else if (!s.isPlaying) selectedId = null;
		} catch {
			// Offline: keep what is on screen.
		}
	}

	onMount(() => {
		void (async () => {
			try {
				const res = await fetch('/api/music/playlists');
				if (res.ok) playlists = await res.json();
			} catch {
				// Show the empty state.
			}
			loaded = true;
		})();
		void refresh();
		const t = window.setInterval(refresh, POLL_MS);
		return () => window.clearInterval(t);
	});

	function trouble(code?: string) {
		starting = false;
		playing = false;
		if (code === 'no_device') asleep = true;
		else failed = true;
	}

	async function pick(p: Playlist) {
		failed = false;
		retryId = p.id;
		selectedId = p.id;
		starting = true;
		playing = true;
		const r = await post('play', { playlistId: p.id });
		if (!r.ok) return trouble(r.code);
		starting = false;
		void refresh();
	}

	async function toggle() {
		failed = false;
		const wasPlaying = playing;
		playing = !wasPlaying;
		const r = await post(wasPlaying ? 'pause' : 'resume');
		if (!r.ok) {
			playing = wasPlaying;
			trouble(r.code);
		}
	}

	async function skip(dir: 'next' | 'previous') {
		const r = await post(dir);
		if (!r.ok) trouble(r.code);
		else void refresh();
	}

	async function nudge(delta: number) {
		const want = Math.min(cap, Math.max(0, volume + delta));
		if (want === volume) return;
		volume = want;
		const r = await post('volume', { percent: want });
		if (!r.ok) trouble(r.code);
	}

	function tryAgain() {
		asleep = false;
		const p = playlists.find((x) => x.id === retryId);
		if (p) void pick(p);
	}
</script>

<svelte:head><title>Music · Home Hub</title></svelte:head>
<svelte:window onkeydown={(e) => asleep && e.key === 'Escape' && (asleep = false)} />

<section class="mx-auto flex w-full max-w-7xl flex-col gap-6 p-8 max-sm:p-3 short:gap-3 short:p-3">
	<div class="flex flex-wrap items-center justify-between gap-4">
		<h1 class="text-headline leading-none font-extrabold">Pick your shower music</h1>
		{#if music}
			<span
				data-testid="speaker-chip"
				class="inline-flex items-center gap-3 rounded-chip px-5 py-2 text-body font-extrabold {music.online
					? 'bg-success-soft text-success'
					: 'bg-surface-sunken text-ink-muted'}"
			>
				<span class="size-3 rounded-chip bg-current" aria-hidden="true"></span>
				{music.online ? 'Speaker ready' : 'Speaker asleep'}
			</span>
		{/if}
	</div>

	{#if loaded && playlists.length === 0}
		<div class="flex flex-col items-start gap-6" data-testid="music-empty">
			<p class="text-lead text-ink-muted">No music is set up yet. Ask a grown-up.</p>
			{#if page.data.adult === true}
				<a
					href={resolve('/(app)/settings/music')}
					class="press inline-flex min-h-tap-kid items-center rounded-control bg-accent px-8 text-body font-extrabold text-on-accent shadow-raised"
				>
					Choose playlists in Settings
				</a>
			{/if}
		</div>
	{/if}

	<ul class="grid grid-cols-2 gap-6 max-sm:gap-3 sm:grid-cols-3">
		{#each playlists as p, i (p.id)}
			<li>
				<button
					type="button"
					data-testid="playlist-tile"
					aria-pressed={selectedId === p.id}
					onclick={() => pick(p)}
					class="press flex min-h-tap-kid w-full flex-col overflow-hidden rounded-card bg-surface-raised text-left shadow-raised {selectedId ===
					p.id
						? 'border-4 border-accent'
						: 'border-4 border-transparent'}"
				>
					<span class="relative block aspect-square w-full {TINTS[i % TINTS.length]}">
						{#if p.cover && !broken[p.id]}
							<img
								src={p.cover}
								alt=""
								loading="lazy"
								referrerpolicy="no-referrer"
								class="absolute inset-0 size-full object-cover"
								onerror={() => (broken[p.id] = true)}
							/>
						{:else}
							<span class="absolute inset-0 grid place-items-center text-display text-on-accent">
								<Icon name="music" />
							</span>
						{/if}
					</span>
					<span class="flex flex-col gap-1 p-4 max-sm:p-2">
						<span class="text-lead leading-tight font-extrabold text-ink">{p.name}</span>
						<span class="text-caption text-ink-muted">{p.tracks} tracks</span>
						{#if selectedId === p.id}
							<span class="text-caption font-extrabold text-accent" data-testid="playing-now">
								{starting ? 'Starting...' : playing ? 'Playing now' : 'Paused'}
							</span>
						{/if}
					</span>
				</button>
			</li>
		{/each}
	</ul>

	{#if failed}
		<p class="text-lead text-danger" role="alert" data-testid="music-failed">
			That did not work. Try again, or ask a grown-up.
		</p>
	{/if}
</section>

{#if selected}
	<div
		class="sticky bottom-0 z-10 border-t-2 border-line bg-surface-raised p-4 pb-safe-4 shadow-float max-sm:p-2"
		data-testid="now-playing"
	>
		<div class="mx-auto flex max-w-7xl flex-wrap items-center gap-x-8 gap-y-3">
			<div class="min-w-0 flex-1 basis-48">
				<p class="truncate text-lead font-extrabold" data-testid="np-track">
					{music?.track ?? selected.name}
				</p>
				<p class="truncate text-caption text-ink-muted">
					{music?.track ? `${music.artist ?? ''} · ${selected.name}` : 'Getting ready...'}
				</p>
			</div>

			<div class="flex items-center gap-3">
				<Button
					variant="secondary"
					size="kid"
					class="px-0!"
					aria-label="Previous song"
					data-testid="np-prev"
					onclick={() => skip('previous')}>⏮</Button
				>
				<Button
					size="kid"
					class="min-h-tap-kid-lg min-w-tap-kid-lg px-0! text-headline"
					aria-label={playing ? 'Pause' : 'Play'}
					data-testid="np-toggle"
					onclick={toggle}>{playing ? '⏸' : '▶'}</Button
				>
				<Button
					variant="secondary"
					size="kid"
					class="px-0!"
					aria-label="Next song"
					data-testid="np-next"
					onclick={() => skip('next')}>⏭</Button
				>
			</div>

			<div class="flex items-center gap-3" data-testid="volume">
				<Button
					variant="secondary"
					size="kid"
					class="px-0!"
					aria-label="Quieter"
					data-testid="vol-down"
					onclick={() => nudge(-STEP)}>−</Button
				>
				<div class="flex w-40 flex-col gap-1 max-sm:w-24">
					<div
						class="relative h-4 overflow-hidden rounded-chip bg-surface-sunken"
						role="meter"
						aria-label="Volume"
						aria-valuemin="0"
						aria-valuemax={cap}
						aria-valuenow={volume}
					>
						<div class="h-full bg-accent" style:width="{cap > 0 ? (volume / cap) * 100 : 0}%"></div>
					</div>
					<p class="text-caption text-ink-muted" data-testid="vol-note">
						{volume >= cap ? 'As loud as it goes' : `${volume}%`}
					</p>
				</div>
				<Button
					variant="secondary"
					size="kid"
					class="px-0!"
					aria-label="Louder"
					data-testid="vol-up"
					disabled={volume >= cap}
					onclick={() => nudge(STEP)}>+</Button
				>
			</div>

			{#if remaining !== null && playing}
				<span
					class="rounded-chip bg-star-soft px-5 py-2 text-body font-extrabold text-ink"
					data-testid="timer-badge"
				>
					Music stops in {clock(remaining)}
				</span>
			{/if}
		</div>
	</div>
{/if}

{#if asleep}
	<div class="fixed inset-0 z-50 flex items-end justify-center p-safe-8 landscape:items-center">
		<button
			type="button"
			aria-label="Not now"
			class="scrim absolute inset-0"
			onclick={() => (asleep = false)}
		></button>
		<div
			role="dialog"
			aria-modal="true"
			aria-labelledby="asleep-title"
			data-testid="speaker-asleep"
			class="sheet relative flex w-full max-w-2xl flex-col gap-6 rounded-sheet bg-surface-raised p-10 text-ink shadow-float short:max-h-full short:gap-3 short:overflow-y-auto short:p-4"
		>
			<h2 id="asleep-title" class="text-headline leading-tight font-extrabold">
				The speaker is asleep
			</h2>
			<p class="text-lead text-ink-muted">
				Press its power button, then tap Try again. Still quiet? Ask a grown-up.
			</p>
			<div class="flex flex-wrap justify-end gap-4">
				<Button variant="secondary" size="kid" onclick={() => (asleep = false)}>Not now</Button>
				<Button size="kid" data-testid="asleep-retry" onclick={tryAgain}>Try again</Button>
			</div>
		</div>
	</div>
{/if}

<style>
	.scrim {
		background: color-mix(in oklch, var(--color-ink) 45%, transparent);
		animation: fade var(--duration-base) linear both;
	}
	.sheet {
		animation: rise var(--duration-base) var(--ease-out-soft) both;
	}
	@keyframes fade {
		from {
			opacity: 0;
		}
	}
	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(2rem);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.scrim,
		.sheet {
			animation: none;
		}
	}
</style>
