<script lang="ts">
	import { jarSlots } from '#lib/domain/kid-chores.js';
	import { jarCaption, jarFill } from '#lib/domain/goal-jar.js';
	import StarIcon from './StarIcon.svelte';

	export interface Goal {
		/** The reward's id. */
		id: string;
		title: string;
		image: string | null;
		cost: number;
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

	const fill = $derived(goal ? jarFill(balance, pending, goal.cost) : null);
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
	class="flex flex-col gap-6 rounded-card bg-surface-sunken p-8 tablet:gap-3 tablet:p-4 portrait:tablet:grid portrait:tablet:grid-cols-2 portrait:tablet:items-center"
>
	<div
		class="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 portrait:tablet:col-span-2"
	>
		<h2 class="text-title leading-none font-extrabold tablet:text-lead">My star jar</h2>
		<p data-testid="jar-caption" class="text-lead font-extrabold text-ink-muted tablet:text-body">
			{balance}
			{balance === 1 ? 'star' : 'stars'}{pending > 0 ? ` · ${pending} waiting` : ''}
		</p>
	</div>

	<div
		bind:this={jar}
		data-testid="jar-glass"
		class="flex min-h-48 flex-wrap-reverse content-start justify-center gap-1 rounded-sheet rounded-t-card border-4 border-line bg-surface-raised p-5 tablet:min-h-16 tablet:p-2 {goal &&
		fill
			? ''
			: 'portrait:tablet:col-span-2'}"
	>
		{#each cells as kind, i (i)}
			<StarIcon variant={kind} class="size-14 tablet:size-7" />
		{/each}
	</div>

	<span class="sr-only" data-testid="jar-counts">
		{slots.gold} gold stars, {slots.pending} waiting for a grown-up
	</span>

	{#if goal && fill}
		<div
			data-testid="jar-goal"
			data-reached={fill.reached}
			class="flex items-center gap-6 tablet:gap-4"
		>
			<div class="relative h-48 w-36 shrink-0 tablet:h-20 tablet:w-14" aria-hidden="true">
				<div class="absolute inset-x-6 top-0 h-6 rounded-control bg-line"></div>
				<div
					class="absolute inset-x-0 top-4 bottom-0 overflow-hidden rounded-card rounded-t-sheet border-4 border-line bg-surface-raised"
				>
					<div
						data-testid="goal-fill-pending"
						class="fill absolute inset-0 origin-bottom bg-star-pending"
						style:transform="scaleY({fill.pending})"
					></div>
					<div
						data-testid="goal-fill"
						class="fill absolute inset-0 origin-bottom bg-star"
						style:transform="scaleY({fill.gold})"
					></div>
					<span class="absolute inset-0 grid place-items-center text-title">
						{goal.image ?? '🎁'}
					</span>
				</div>
			</div>
			<div class="flex min-w-0 grow flex-col gap-2">
				<p class="text-lead leading-tight font-extrabold break-words tablet:text-body">
					{goal.title}
				</p>
				<p data-testid="goal-caption" class="text-lead font-extrabold tablet:text-body">
					{jarCaption(balance, goal.cost)}
				</p>
				<p class="text-caption font-bold text-ink-muted tablet:text-caption">
					{fill.reached ? 'You earned it! Ask a grown-up.' : `${fill.remaining} more to go`}
				</p>
			</div>
		</div>
	{/if}
</section>

<style>
	.fill {
		transition: transform var(--duration-slow) var(--ease-out-soft);
	}
</style>
