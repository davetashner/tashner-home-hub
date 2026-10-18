<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import FunGate from '#lib/components/kid/FunGate.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Icon from '#lib/components/shell/Icon.svelte';
	import {
		GAME_ACTIVE_EVENT,
		GAME_HEARTBEAT_MS,
		GAME_HOLD_MAX_MS,
		parseGames,
		type Game
	} from '#lib/domain/games.js';

	const CACHE_KEY = 'hub.games.cache';
	/** A frame that has not finished loading by now is treated as unreachable. */
	const LOAD_TIMEOUT_MS = 15_000;
	/** Token-coloured placeholders for tiles without a preview image. */
	const TINTS = [
		'bg-member-1',
		'bg-member-2',
		'bg-member-3',
		'bg-member-4',
		'bg-member-5',
		'bg-member-6'
	];

	let games = $state<Game[]>([]);
	let loaded = $state(false);
	let open = $state<Game | null>(null);
	let frameLoaded = $state(false);
	let unreachable = $state(false);
	let broken = $state<Record<string, true>>({});
	/** Bumped to remount the frame when retrying. */
	let attempt = $state(0);

	async function load() {
		try {
			const res = await fetch('/api/games');
			if (res.ok) {
				// This origin, not the server's: the hub may be opened at another address than the one the game was added from.
				games = parseGames(await res.json(), location.origin);
				try {
					localStorage.setItem(CACHE_KEY, JSON.stringify(games));
				} catch {
					// Storage unavailable: the cache is only a convenience.
				}
			}
		} catch {
			try {
				games = parseGames(JSON.parse(localStorage.getItem(CACHE_KEY) ?? '[]'), location.origin);
			} catch {
				// Nothing cached: show the empty state.
			}
		}
		loaded = true;
	}
	onMount(load);

	function launch(game: Game) {
		open = game;
		frameLoaded = false;
		unreachable = typeof navigator !== 'undefined' && navigator.onLine === false;
		attempt++;
	}

	function close() {
		open = null;
	}

	// While a game is open: watch the connection, give up on a frame that never loads, and keep
	// telling the wall's idle watcher someone is playing (taps inside the frame never reach this page).
	$effect(() => {
		if (!open) return;
		void attempt;
		const ping = () => window.dispatchEvent(new Event(GAME_ACTIVE_EVENT));
		const heartbeat = window.setInterval(ping, GAME_HEARTBEAT_MS);
		const stopHolding = window.setTimeout(() => window.clearInterval(heartbeat), GAME_HOLD_MAX_MS);
		const timeout = window.setTimeout(() => {
			if (!frameLoaded) unreachable = true;
		}, LOAD_TIMEOUT_MS);
		const offline = () => {
			unreachable = true;
		};
		window.addEventListener('offline', offline);
		// A failed frame still fires `load` (with the browser's error page), so probe the address too:
		// a no-cors request rejects exactly when the network or host is unreachable.
		const probe = new AbortController();
		fetch(open.url, { mode: 'no-cors', cache: 'no-store', signal: probe.signal }).catch(() => {
			if (!probe.signal.aborted) unreachable = true;
		});
		ping();
		return () => {
			window.clearInterval(heartbeat);
			window.clearTimeout(stopHolding);
			window.clearTimeout(timeout);
			window.removeEventListener('offline', offline);
			probe.abort();
		};
	});

	function retry() {
		frameLoaded = false;
		unreachable = typeof navigator !== 'undefined' && navigator.onLine === false;
		attempt++;
	}

	function onframeload() {
		frameLoaded = true;
	}
	/** Games and Music wait while this kid still has jobs to finish (hub-ruz). */
	let funLocked = $state(false);
</script>

<svelte:head><title>Games · Home Hub</title></svelte:head>

<FunGate onlock={(locked) => (funLocked = locked)} />
<section
	style:display={funLocked ? 'none' : undefined}
	class="mx-auto flex w-full max-w-7xl flex-col gap-8 p-8 max-sm:p-3 short:gap-4 short:p-3"
>
	<h1 class="text-headline leading-none font-extrabold">Games</h1>

	{#if loaded && games.length === 0}
		<div class="flex flex-col items-start gap-6" data-testid="games-empty">
			<p class="text-lead text-ink-muted">No games yet.</p>
			{#if page.data.adult === true}
				<a
					href={resolve('/(app)/settings/games')}
					data-testid="games-settings-link"
					class="press inline-flex min-h-tap-kid items-center rounded-control bg-accent px-8 text-body font-extrabold text-on-accent shadow-raised"
				>
					Add games in Settings
				</a>
			{/if}
		</div>
	{/if}

	<ul class="grid grid-cols-2 gap-6 max-sm:gap-3 sm:grid-cols-3 landscape:lg:grid-cols-4">
		{#each games as game, i (game.id)}
			<li>
				<button
					type="button"
					data-testid="game-tile"
					onclick={() => launch(game)}
					class="press flex min-h-tap-kid w-full flex-col overflow-hidden rounded-card bg-surface-raised text-left shadow-raised"
				>
					<span class="relative block aspect-video w-full {TINTS[i % TINTS.length]}">
						{#if game.image && !broken[game.id]}
							<img
								src={game.image}
								alt=""
								loading="lazy"
								class="absolute inset-0 size-full object-cover"
								onerror={() => (broken[game.id] = true)}
							/>
						{:else}
							<span class="absolute inset-0 grid place-items-center text-display text-on-accent">
								<Icon name="games" />
							</span>
						{/if}
					</span>
					<span class="p-4 text-lead leading-tight font-extrabold text-ink">{game.title}</span>
				</button>
			</li>
		{/each}
	</ul>
</section>

{#if open}
	<div
		class="fixed inset-0 z-50 flex flex-col bg-frame text-on-frame"
		role="dialog"
		aria-modal="true"
		aria-label={open.title}
		data-testid="game-player"
	>
		<div class="flex items-center gap-4 p-3 pt-safe-2 pr-safe-2 pl-safe-2">
			<Button size="kid" onclick={close} data-testid="game-back" class="gap-3">
				<span aria-hidden="true">←</span>
				Back
			</Button>
			<p class="min-w-0 flex-1 truncate text-lead font-extrabold">{open.title}</p>
		</div>
		<div class="relative min-h-0 flex-1">
			{#key attempt}
				<iframe
					title={open.title}
					src={open.url}
					allow="autoplay; fullscreen"
					sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-forms"
					referrerpolicy="no-referrer"
					class="size-full border-0 bg-surface"
					onload={onframeload}
				></iframe>
			{/key}
			{#if unreachable}
				<div
					class="absolute inset-0 flex flex-col items-center justify-center gap-6 bg-surface p-8 text-center text-ink"
					data-testid="game-offline"
				>
					<p class="text-headline font-extrabold">Games need the internet</p>
					<p class="text-lead text-ink-muted">Check the connection, then try again.</p>
					<Button size="kid" onclick={retry}>Try again</Button>
				</div>
			{/if}
		</div>
	</div>
{/if}
