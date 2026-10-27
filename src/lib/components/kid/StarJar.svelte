<script lang="ts">
	import { jarSlots } from '#lib/domain/kid-chores.js';
	import { jarCaption, jarFill } from '#lib/domain/goal-jar.js';
	import Button from '#lib/components/ui/Button.svelte';
	import GoalsSheet from './GoalsSheet.svelte';
	import RewardShop from './RewardShop.svelte';
	import StickerBook from './StickerBook.svelte';
	import StarIcon from './StarIcon.svelte';

	export interface Goal {
		/** The reward's id. */
		id: string;
		title: string;
		image: string | null;
		cost: number;
	}

	let {
		memberId,
		onchanged = () => {},
		balance,
		pending,
		goal = null,
		jar = $bindable(null)
	}: {
		memberId: string;
		/** The shop changed the goal or spent stars: reload the jar. */
		onchanged?: () => void;
		balance: number;
		pending: number;
		goal?: Goal | null;
		jar?: HTMLElement | null;
	} = $props();

	let shopOpen = $state(false);
	let goalsOpen = $state(false);
	let stickersOpen = $state(false);

	const fill = $derived(goal ? jarFill(balance, pending, goal.cost) : null);
	const slots = $derived(jarSlots(balance, pending, goal?.cost ?? null));
	const cells = $derived(
		Array.from({ length: slots.total }, (_, i) =>
			i < slots.gold ? 'gold' : i < slots.gold + slots.pending ? 'outline' : 'empty'
		) as ('gold' | 'outline' | 'empty')[]
	);
</script>

<!-- A slim strip (hub-3yg): star balance, the jar's stars, the goal bar and the shop. -->
<section
	data-testid="star-jar"
	aria-label="Star jar"
	class="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-card bg-surface-sunken px-4 py-2 short:gap-x-2 short:gap-y-1 short:px-2 short:py-1 tablet:gap-x-3 tablet:landscape:flex-nowrap"
>
	<p
		data-testid="jar-caption"
		class="text-body font-extrabold whitespace-nowrap text-ink-muted short:text-caption short:whitespace-normal"
	>
		{balance}
		{balance === 1 ? 'star' : 'stars'}{pending > 0 ? ` · ${pending} waiting` : ''}
	</p>

	<div
		bind:this={jar}
		data-testid="jar-glass"
		class="flex min-w-0 flex-wrap content-start gap-0.5 rounded-control border-2 border-line bg-surface-raised px-2 py-1 short:px-1 short:py-0.5"
	>
		{#each cells as kind, i (i)}
			<StarIcon variant={kind} class="size-8 short:size-4 tablet:size-5" />
		{/each}
	</div>

	<span class="sr-only" data-testid="jar-counts">
		{slots.gold} gold stars, {slots.pending} waiting for a grown-up
	</span>

	{#if goal && fill}
		<div
			data-testid="jar-goal"
			data-reached={fill.reached}
			class="flex min-w-48 grow basis-0 items-center gap-3 short:min-w-0 short:basis-full short:gap-2"
		>
			<span class="text-headline leading-none short:text-title" aria-hidden="true">
				{goal.image ?? '🎁'}
			</span>
			<div class="flex min-w-0 grow flex-col gap-1">
				<div class="flex items-baseline justify-between gap-3">
					<p class="min-w-0 truncate text-body leading-tight font-extrabold short:text-caption">
						{goal.title}
					</p>
					<p
						data-testid="goal-caption"
						class="text-body font-extrabold whitespace-nowrap short:text-caption short:whitespace-normal"
					>
						{jarCaption(balance, goal.cost)}
					</p>
				</div>
				<div
					class="relative h-4 overflow-hidden rounded-chip bg-surface-raised ring-2 ring-line short:h-3"
					aria-hidden="true"
				>
					<div
						data-testid="goal-fill-pending"
						class="fill absolute inset-0 origin-left bg-star-pending"
						style:transform="scaleX({fill.pending})"
					></div>
					<div
						data-testid="goal-fill"
						class="fill absolute inset-0 origin-left bg-star"
						style:transform="scaleX({fill.gold})"
					></div>
				</div>
				<p class="text-caption font-bold text-ink-muted">
					{fill.reached ? 'You earned it! Ask a grown-up.' : `${fill.remaining} more to go`}
				</p>
			</div>
		</div>
	{/if}

	<div class="ml-auto flex shrink-0 gap-3 short:ml-0 short:w-full short:flex-col short:gap-1">
		<Button
			variant="secondary"
			size="kid"
			class="px-4! short:w-full"
			data-testid="open-stickers"
			aria-label="My stickers"
			onclick={() => (stickersOpen = true)}><span aria-hidden="true">🏅</span></Button
		>
		<Button
			variant="secondary"
			size="kid"
			class="px-4! short:w-full"
			data-testid="open-goals"
			aria-label="My goals"
			onclick={() => (goalsOpen = true)}><span aria-hidden="true">🎯</span></Button
		>
		<Button
			size="kid"
			class="px-6! short:grow short:px-2! short:text-body!"
			data-testid="open-shop"
			onclick={() => (shopOpen = true)}>Shop</Button
		>
	</div>
</section>

{#if stickersOpen}
	<StickerBook {memberId} onclose={() => (stickersOpen = false)} />
{/if}

{#if goalsOpen}
	<GoalsSheet {memberId} {balance} onclose={() => (goalsOpen = false)} {onchanged} />
{/if}

{#if shopOpen}
	<RewardShop
		{memberId}
		{balance}
		goal={goal && { id: goal.id, title: goal.title, cost: goal.cost }}
		onclose={() => (shopOpen = false)}
		{onchanged}
	/>
{/if}

<style>
	.fill {
		transition: transform var(--duration-slow) var(--ease-out-soft);
	}
</style>
