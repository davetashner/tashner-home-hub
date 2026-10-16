<script lang="ts">
	import {
		isDoable,
		undoSecondsLeft,
		UNDO_WINDOW_MS,
		type KidChore
	} from '#lib/domain/kid-chores.js';
	import Button from '#lib/components/ui/Button.svelte';
	import StarIcon from './StarIcon.svelte';

	let {
		chore,
		undoStartedAt = null,
		ondone,
		onundo,
		onundoexpire
	}: {
		chore: KidChore;
		/** When the tap happened, while the "Oops, undo" pill is still open. */
		undoStartedAt?: number | null;
		ondone: (chore: KidChore, card: HTMLElement) => void;
		onundo: (chore: KidChore) => void;
		onundoexpire: (chore: KidChore) => void;
	} = $props();

	let card = $state<HTMLElement | null>(null);
	let now = $state(Date.now());

	$effect(() => {
		if (undoStartedAt === null) return;
		now = Date.now();
		const timer = setInterval(() => {
			now = Date.now();
			if (undoSecondsLeft(undoStartedAt, now) === 0) onundoexpire(chore);
		}, 250);
		return () => clearInterval(timer);
	});

	const doable = $derived(isDoable(chore.status));
	const showUndo = $derived(
		undoStartedAt !== null && chore.status === 'pending' && undoSecondsLeft(undoStartedAt, now) > 0
	);
	const stars = $derived(Math.min(5, Math.max(1, chore.stars)));
</script>

<article
	bind:this={card}
	data-testid="chore-card"
	data-status={chore.status}
	class="card relative flex flex-col gap-6 overflow-hidden rounded-card p-8 shadow-raised landscape:flex-row landscape:items-center landscape:gap-10 {chore.status ===
	'approved'
		? 'bg-success-soft'
		: 'bg-surface-raised'}"
>
	<div class="flex min-w-0 grow items-center gap-6">
		<span
			class="grid size-32 shrink-0 place-items-center rounded-chip bg-accent-soft text-display leading-none {doable
				? ''
				: 'opacity-70'}"
			aria-hidden="true"
		>
			{chore.icon ?? '⭐'}
		</span>
		<div class="flex min-w-0 grow flex-col gap-3">
			<h3 class="text-title leading-tight font-extrabold text-balance">{chore.title}</h3>
			<div
				class="flex gap-1"
				role="img"
				aria-label="{chore.stars} {chore.stars === 1 ? 'star' : 'stars'}"
			>
				{#each { length: stars } as _, i (i)}
					<StarIcon variant={chore.status === 'pending' ? 'outline' : 'gold'} class="size-14" />
				{/each}
			</div>
		</div>
	</div>

	<div class="flex flex-col gap-4 landscape:w-1/2 landscape:shrink-0">
		{#if doable}
			{#if chore.status === 'rejected'}
				<p class="page-enter text-lead font-bold text-ink-muted" data-testid="gentle-note">
					Let&rsquo;s try that one again 💛
				</p>
			{/if}
			<Button
				size="kid"
				class="min-h-32 w-full text-title"
				data-testid="did-it"
				onclick={() => card && ondone(chore, card)}
			>
				I did it!
			</Button>
		{:else if chore.status === 'pending'}
			<div
				class="page-enter flex min-h-32 items-center justify-center gap-4 rounded-card bg-star-soft px-8 text-center"
				data-testid="waiting"
			>
				<span class="text-lead" aria-hidden="true">⏳</span>
				<p class="text-lead font-extrabold">Waiting for grown-up</p>
			</div>
			{#if showUndo && undoStartedAt !== null}
				<button
					type="button"
					data-testid="undo"
					class="undo page-enter relative inline-flex min-h-tap-kid w-full items-center justify-center gap-4 overflow-hidden rounded-chip border-4 border-line bg-surface px-8 text-lead font-extrabold text-ink"
					onclick={() => onundo(chore)}
				>
					<span
						class="countdown absolute inset-0 origin-left bg-accent-soft"
						style:animation-duration="{UNDO_WINDOW_MS}ms"
						aria-hidden="true"
					></span>
					<span class="relative">Oops, undo</span>
					<span class="relative tabular-nums" data-testid="undo-seconds">
						{undoSecondsLeft(undoStartedAt, now)}
					</span>
				</button>
			{/if}
		{:else}
			<div
				class="page-enter flex min-h-32 items-center justify-center gap-4 rounded-card bg-star px-8 text-ink"
				data-testid="done"
			>
				<span class="text-title leading-none" aria-hidden="true">✓</span>
				<p class="text-title leading-none font-extrabold">Done!</p>
			</div>
		{/if}
	</div>
</article>

<style>
	@keyframes drain {
		from {
			transform: scaleX(1);
		}
		to {
			transform: scaleX(0);
		}
	}
	.countdown {
		animation: drain linear both;
	}
	.undo {
		transition: transform var(--duration-quick) var(--ease-out-soft);
		cursor: pointer;
	}
	.undo:active {
		transform: scale(0.95);
		transition-duration: var(--duration-instant);
	}
	.undo:focus-visible {
		outline: 4px solid var(--color-accent);
		outline-offset: 4px;
	}
	@media (prefers-reduced-motion: reduce) {
		.countdown {
			animation: none;
		}
	}
</style>
