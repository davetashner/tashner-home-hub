<!--
	Space Junk (hub-26w.3): level select, the game screen with its HUD, and the end card.
	In-game stars are not hub stars and never touch the ledger. Locked whenever Games is locked.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import FunGate from '#lib/components/kid/FunGate.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import SpaceJunkCanvas, {
		type GameState
	} from '#lib/components/space-junk/SpaceJunkCanvas.svelte';
	import { LEVELS } from '#lib/domain/space-junk/levels.js';
	import {
		isUnlocked,
		loadProgress,
		recordResult,
		saveProgress,
		type Progress
	} from '#lib/domain/space-junk/progress.js';
	import { GAME_ACTIVE_EVENT, GAME_HEARTBEAT_MS, GAME_HOLD_MAX_MS } from '#lib/domain/games.js';

	const KID_KEY = 'hub.kid';
	const ids = LEVELS.map((l) => l.id);

	let funLocked = $state(false);
	let memberId = $state<string | null>(null);
	let progress = $state<Progress>({});
	/** Index of the open level, or null on the level select. */
	let current = $state<number | null>(null);
	let menu = $state(false);
	let game = $state<GameState | null>(null);
	let canvas = $state<{ restart: () => void } | undefined>();

	onMount(() => {
		let remembered: string | null = null;
		try {
			remembered = localStorage.getItem(KID_KEY);
		} catch {
			// No storage: progress is per device.
		}
		memberId = page.url.searchParams.get('member') ?? remembered;
		progress = loadProgress(memberId);
	});

	const level = $derived(current === null ? null : LEVELS[current]!);
	const ended = $derived(game !== null && (game.phase === 'won' || game.phase === 'lost'));
	const hasNext = $derived(current !== null && current + 1 < LEVELS.length);
	const memberQuery = $derived(memberId ? `?member=${encodeURIComponent(memberId)}` : '');

	function open(i: number) {
		if (!isUnlocked(progress, ids, i)) return;
		game = null;
		menu = false;
		current = i;
	}
	function levels() {
		current = null;
		menu = false;
		game = null;
	}
	function retry() {
		menu = false;
		game = null;
		canvas?.restart();
	}
	function next() {
		if (current !== null && hasNext) open(current + 1);
	}

	function onchange(s: GameState) {
		game = s;
		if (s.phase === 'won' && level) {
			progress = recordResult(progress, level.id, s.stars);
			saveProgress(memberId, progress);
		}
	}

	// While a level is open, tell the wall's idle watcher someone is playing.
	$effect(() => {
		if (current === null) return;
		const ping = () => window.dispatchEvent(new Event(GAME_ACTIVE_EVENT));
		const heartbeat = window.setInterval(ping, GAME_HEARTBEAT_MS);
		const stop = window.setTimeout(() => window.clearInterval(heartbeat), GAME_HOLD_MAX_MS);
		ping();
		return () => {
			window.clearInterval(heartbeat);
			window.clearTimeout(stop);
		};
	});

	const starRow = (n: number) => '★'.repeat(n) + '☆'.repeat(3 - n);
</script>

<svelte:head><title>Space Junk · Home Hub</title></svelte:head>

<FunGate onlock={(locked) => (funLocked = locked)} />

{#if !funLocked}
	<section
		style:display={current === null ? undefined : 'none'}
		class="mx-auto flex w-full max-w-7xl flex-col gap-8 p-8 max-sm:p-3 short:gap-4 short:p-3"
		data-testid="sj-levels"
	>
		<div class="flex items-center gap-6">
			<!-- eslint-disable svelte/no-navigation-without-resolve -->
			<a
				href={resolve('/(app)/games') + memberQuery}
				data-testid="sj-exit"
				class="press inline-flex min-h-tap-kid min-w-tap-kid items-center justify-center rounded-card bg-control px-8 text-title font-extrabold text-ink shadow-raised"
				aria-label="Back to Games">←</a
			>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
			<h1 class="text-headline leading-none font-extrabold">Space Junk</h1>
		</div>
		<ul class="grid grid-cols-2 gap-6 max-sm:gap-3 sm:grid-cols-3 landscape:lg:grid-cols-5">
			{#each LEVELS as lv, i (lv.id)}
				{@const unlocked = isUnlocked(progress, ids, i)}
				<li>
					<button
						type="button"
						data-testid="sj-level"
						data-unlocked={unlocked}
						disabled={!unlocked}
						onclick={() => open(i)}
						class="press bg-space-sky flex min-h-tap-kid w-full flex-col items-center gap-2 rounded-card p-4 text-on-frame shadow-raised disabled:opacity-50"
					>
						<span class="text-headline leading-none font-extrabold">{i + 1}</span>
						<span class="text-lead leading-tight font-extrabold">{lv.name}</span>
						<span class="text-title text-star" aria-label="{progress[lv.id] ?? 0} of 3 stars">
							{unlocked ? starRow(progress[lv.id] ?? 0) : '🔒'}
						</span>
					</button>
				</li>
			{/each}
		</ul>
	</section>

	{#if level}
		<div
			class="bg-space-sky fixed inset-0 z-50 text-on-frame"
			role="dialog"
			aria-modal="true"
			aria-label="Space Junk: {level.name}"
			data-testid="sj-game"
		>
			<SpaceJunkCanvas bind:this={canvas} {level} {onchange} />

			<div
				class="pointer-events-none absolute inset-x-0 top-0 flex items-start gap-4 p-3 pt-safe-2 pr-safe-2 pl-safe-2"
			>
				<div
					class="pointer-events-none flex flex-1 flex-col gap-1 text-title font-extrabold"
					data-testid="sj-hud"
				>
					<p aria-label="{game?.junkbotsLeft ?? level.junkbots} Junkbots left">
						{#each Array.from({ length: game?.junkbotsLeft ?? level.junkbots }, (_, k) => k) as k (k)}
							<span aria-hidden="true">🤖</span>
						{/each}
					</p>
					<p data-testid="sj-gremlins">👾 {game?.gremlinsLeft ?? '·'} Gremlins</p>
				</div>
				<Button
					size="kid"
					variant="secondary"
					data-testid="sj-pause"
					class="pointer-events-auto"
					onclick={() => (menu = true)}
				>
					Menu
				</Button>
				<Button
					size="kid"
					variant="secondary"
					data-testid="sj-restart"
					class="pointer-events-auto"
					onclick={retry}
				>
					Restart
				</Button>
				<Button
					size="kid"
					variant="secondary"
					data-testid="sj-back"
					class="pointer-events-auto"
					onclick={levels}
				>
					Levels
				</Button>
			</div>

			{#if ended && game}
				<div class="absolute inset-0 grid place-items-center p-4" data-testid="sj-end">
					<div
						class="sj-pop flex w-full max-w-lg flex-col items-center gap-6 rounded-card bg-surface p-8 text-center text-ink shadow-raised"
					>
						<h2 class="text-headline leading-none font-extrabold">
							{game.phase === 'won' ? 'Gremlins gone!' : 'Out of Junkbots'}
						</h2>
						<p
							class="text-display leading-none text-star"
							data-testid="sj-stars"
							data-stars={game.stars}
						>
							{starRow(game.stars)}
						</p>
						<div class="flex flex-wrap justify-center gap-4">
							{#if game.phase === 'won' && hasNext}
								<Button size="kid" data-testid="sj-next" onclick={next}>Next</Button>
							{/if}
							<Button size="kid" variant="secondary" data-testid="sj-retry" onclick={retry}
								>Retry</Button
							>
							<Button size="kid" variant="secondary" data-testid="sj-levels-btn" onclick={levels}
								>Levels</Button
							>
						</div>
					</div>
				</div>
			{:else if menu}
				<div class="absolute inset-0 grid place-items-center bg-frame/60 p-4" data-testid="sj-menu">
					<div
						class="flex w-full max-w-lg flex-col items-center gap-6 rounded-card bg-surface p-8 text-ink shadow-raised"
					>
						<h2 class="text-headline leading-none font-extrabold">Paused</h2>
						<div class="flex flex-wrap justify-center gap-4">
							<Button size="kid" data-testid="sj-resume" onclick={() => (menu = false)}
								>Resume</Button
							>
							<Button size="kid" variant="secondary" onclick={retry}>Restart</Button>
							<Button size="kid" variant="secondary" onclick={levels}>Levels</Button>
						</div>
					</div>
				</div>
			{/if}
		</div>
	{/if}
{/if}

<style>
	/* The end card pops in; only transform and opacity animate. */
	.sj-pop {
		animation: sj-pop var(--duration-quick, 200ms) var(--ease-out-soft, ease-out);
	}
	@keyframes sj-pop {
		from {
			opacity: 0;
			transform: scale(0.9);
		}
		to {
			opacity: 1;
			transform: scale(1);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.sj-pop {
			animation: none;
		}
	}
</style>
