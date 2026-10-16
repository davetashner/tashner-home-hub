<script lang="ts">
	import { jarSlots } from '#lib/domain/kid-chores.js';
	import StarIcon from './StarIcon.svelte';

	export interface Goal {
		title: string;
		image: string | null;
		cost: number;
		remaining: number;
		percent: number;
	}

	let {
		balance,
		pending,
		goal = null,
		jar = $bindable(null)
	}: {
		balance: number;
		pending: number;
		goal?: Goal | null;
		jar?: HTMLElement | null;
	} = $props();

	const slots = $derived(jarSlots(balance, pending, goal?.cost ?? null));
	const cells = $derived(
		Array.from({ length: slots.total }, (_, i) =>
			i < slots.gold ? 'gold' : i < slots.gold + slots.pending ? 'outline' : 'empty'
		) as ('gold' | 'outline' | 'empty')[]
	);
</script>

<section
	data-testid="star-jar"
	aria-label="Star jar"
	class="flex flex-col gap-6 rounded-card bg-surface-sunken p-8"
>
	<div class="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
		<h2 class="text-title leading-none font-extrabold">My star jar</h2>
		<p data-testid="jar-caption" class="text-lead font-extrabold text-ink-muted">
			{balance}
			{balance === 1 ? 'star' : 'stars'}{pending > 0 ? ` · ${pending} waiting` : ''}
		</p>
	</div>

	<div
		bind:this={jar}
		data-testid="jar-glass"
		class="flex min-h-48 flex-wrap-reverse content-start justify-center gap-1 rounded-sheet rounded-t-card border-4 border-line bg-surface-raised p-5"
	>
		{#each cells as kind, i (i)}
			<StarIcon variant={kind} class="size-14" />
		{/each}
	</div>

	<span class="sr-only" data-testid="jar-counts">
		{slots.gold} gold stars, {slots.pending} waiting for a grown-up
	</span>

	{#if goal}
		<div data-testid="jar-goal" class="flex items-center gap-5">
			<span class="grid size-24 shrink-0 place-items-center rounded-chip bg-star-soft text-display">
				<span class="text-title">{goal.image ?? '🎁'}</span>
			</span>
			<div class="flex min-w-0 grow flex-col gap-3">
				<p class="text-lead leading-tight font-extrabold">{goal.title}</p>
				<div class="h-6 overflow-hidden rounded-chip bg-line" aria-hidden="true">
					<div
						class="meter h-full origin-left rounded-chip bg-star"
						style:transform="scaleX({goal.percent / 100})"
					></div>
				</div>
				<p class="text-caption font-bold text-ink-muted">
					{goal.remaining === 0 ? 'You did it!' : `${goal.remaining} more to go`}
				</p>
			</div>
		</div>
	{/if}
</section>

<style>
	.meter {
		transition: transform var(--duration-slow) var(--ease-out-soft);
	}
</style>
