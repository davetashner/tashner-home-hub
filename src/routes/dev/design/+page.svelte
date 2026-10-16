<script lang="ts">
	import Button from '#lib/components/ui/Button.svelte';
	import IconButton from '#lib/components/ui/IconButton.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import { swipe } from '#lib/actions/swipe.js';
	import type { SwipeDirection } from '#lib/domain/swipe.js';

	const surfaces = [
		['surface', 'bg-surface'],
		['surface-sunken', 'bg-surface-sunken'],
		['surface-raised', 'bg-surface-raised'],
		['line', 'bg-line'],
		['ink', 'bg-ink'],
		['ink-muted', 'bg-ink-muted'],
		['accent', 'bg-accent'],
		['accent-soft', 'bg-accent-soft'],
		['star', 'bg-star'],
		['star-pending', 'bg-star-pending'],
		['success', 'bg-success'],
		['danger', 'bg-danger']
	];
	const members = [
		'bg-member-1',
		'bg-member-2',
		'bg-member-3',
		'bg-member-4',
		'bg-member-5',
		'bg-member-6'
	];
	const type = [
		['display', 'text-display font-extrabold'],
		['headline', 'text-headline font-extrabold'],
		['title', 'text-title font-bold'],
		['lead', 'text-lead font-semibold'],
		['body', 'text-body'],
		['caption', 'text-caption text-ink-muted']
	];
	const variants = ['primary', 'secondary', 'ghost', 'danger'] as const;
	const shadows = [
		['flat', 'flat'],
		['raised', 'raised'],
		['float', 'float']
	] as const;

	let night = $state(false);
	let last = $state<SwipeDirection | null>(null);
	let earned = $state(3);

	$effect(() => {
		document.documentElement.dataset.theme = night ? 'night' : 'light';
	});
</script>

<svelte:head>
	<title>Design system</title>
</svelte:head>

{#snippet star(filled: boolean)}
	<svg
		viewBox="0 0 24 24"
		class="size-14 {filled ? 'fill-star' : 'fill-star-pending'}"
		aria-hidden="true"
	>
		<path
			stroke-linejoin="round"
			class="stroke-star stroke-1"
			d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.2 6.1 20.6l1.3-6.6L2.5 9.4l6.6-.8z"
		/>
	</svg>
{/snippet}

<main class="page mx-auto flex flex-col gap-12 p-12">
	<header class="flex items-end justify-between gap-8">
		<div>
			<p class="text-caption font-extrabold tracking-widest text-accent uppercase">Design system</p>
			<h1 class="text-headline leading-none font-extrabold">Tashner Home Hub</h1>
		</div>
		<Button variant="secondary" onclick={() => (night = !night)} data-testid="theme-toggle">
			{night ? 'Day theme' : 'Night theme'}
		</Button>
	</header>

	<section class="grid-auto gap-8">
		<Card class="flex flex-col gap-6">
			<h2 class="text-title font-bold">Color roles</h2>
			<div class="swatches">
				{#each surfaces as [name, cls] (name)}
					<div class="flex flex-col gap-2">
						<div class="h-20 rounded-control border-2 border-line {cls}"></div>
						<span class="text-caption text-ink-muted">{name}</span>
					</div>
				{/each}
			</div>
			<h3 class="text-lead font-bold">Family members</h3>
			<div class="flex gap-4">
				{#each members as cls (cls)}
					<div class="size-tap rounded-chip {cls}"></div>
				{/each}
			</div>
		</Card>

		<Card class="flex flex-col gap-4">
			<h2 class="text-title font-bold">Type scale</h2>
			{#each type as [name, cls] (name)}
				<div class="flex items-baseline gap-6">
					<span class="w-40 shrink-0 text-caption text-ink-muted">{name}</span>
					<span class="truncate {cls}">Stars</span>
				</div>
			{/each}
		</Card>
	</section>

	<section class="grid-auto gap-8">
		<Card class="flex flex-col gap-8">
			<h2 class="text-title font-bold">Buttons</h2>
			<div class="flex flex-wrap items-center gap-6">
				{#each variants as variant (variant)}
					<Button {variant}>{variant}</Button>
				{/each}
				<Button disabled>disabled</Button>
			</div>
			<div class="flex flex-wrap items-center gap-6">
				{#each variants as variant (variant)}
					<Button {variant} size="kid">{variant}</Button>
				{/each}
			</div>
			<div class="flex flex-wrap items-center gap-6">
				<IconButton label="Previous">&#8249;</IconButton>
				<IconButton label="Next">&#8250;</IconButton>
				<IconButton label="Add" size="kid">+</IconButton>
			</div>
			<div class="flex flex-wrap items-center gap-4">
				<Badge>Neutral</Badge>
				<Badge tone="accent">Accent</Badge>
				<Badge tone="star">3 stars</Badge>
				<Badge tone="success">Done</Badge>
				<Badge tone="danger">Overdue</Badge>
			</div>
		</Card>

		<Card class="flex flex-col gap-6">
			<h2 class="text-title font-bold">Kid reward</h2>
			<div class="flex gap-2" data-testid="stars">
				{#each [0, 1, 2, 3, 4] as i (i)}
					{@render star(i < earned)}
				{/each}
			</div>
			<Button size="kid" class="self-start" onclick={() => (earned = (earned + 1) % 6)}
				>Tap for a star</Button
			>
			<div
				use:swipe={{ onswipe: (d) => (last = d) }}
				class="swipe-pad flex items-center justify-center rounded-card bg-accent-soft text-lead font-bold text-accent-press"
				data-testid="swipe-pad"
			>
				{last ? `Swiped ${last}` : 'Swipe here'}
			</div>
		</Card>
	</section>

	<section class="grid-three gap-8">
		{#each shadows as [name, elevation] (name)}
			<Card {elevation} class="flex items-center justify-center">
				<span class="text-lead font-bold">{name}</span>
			</Card>
		{/each}
	</section>
</main>

<style>
	.page {
		max-width: 150rem;
	}
	.grid-auto {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 38rem), 1fr));
	}
	.grid-three {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
	}
	.swatches {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
		gap: 1.25rem;
	}
	.swipe-pad {
		min-height: 9rem;
		touch-action: pan-y;
	}
</style>
