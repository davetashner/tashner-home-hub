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
		undoStartedAt !== null &&
			(chore.status === 'pending' || chore.status === 'approved') &&
			undoSecondsLeft(undoStartedAt, now) > 0
	);
	const stars = $derived(Math.min(5, Math.max(1, chore.stars)));
	const habit = $derived(chore.kind === 'habit');
</script>

<article
	bind:this={card}
	data-testid="chore-card"
	data-status={chore.status}
	data-kind={chore.kind ?? 'star_job'}
	class="card relative flex flex-col gap-6 overflow-hidden rounded-card p-8 shadow-raised landscape:flex-row landscape:items-center landscape:gap-10 short:gap-2 short:p-3 tablet:gap-4 tablet:p-5 portrait:tablet:flex-row portrait:tablet:items-center portrait:tablet:gap-6 landscape:tablet:gap-6 {chore.status ===
	'approved'
		? 'bg-success-soft'
		: 'bg-surface-raised'}"
>
	<div
		class="flex min-w-0 grow items-center gap-6 landscape:basis-3/5 short:!basis-auto short:gap-2 tablet:gap-4 portrait:tablet:basis-3/5"
	>
		<span
			class="grid size-24 shrink-0 place-items-center rounded-chip bg-accent-soft text-display leading-none short:size-12 short:text-title short:max-md:size-10 short:max-md:text-lead tablet:size-16 tablet:text-headline {doable
				? ''
				: 'opacity-70'}"
			aria-hidden="true"
		>
			{chore.icon ?? '⭐'}
		</span>
		<div class="flex min-w-0 grow flex-col gap-3 tablet:gap-1">
			<h3
				class="min-w-0 text-title leading-tight font-extrabold break-words short:text-body tablet:text-lead"
			>
				{chore.title}
			</h3>
			{#if habit}
				<!-- A habit earns no stars itself; it counts toward the day's habit star. -->
				<p
					class="w-fit rounded-chip bg-accent-soft px-4 py-1 text-body font-bold short:hidden tablet:text-caption"
					data-testid="habit-tag"
				>
					✅ Daily habit
				</p>
			{:else}
				<!-- Phone landscape: a chore that is already done or waiting drops its stars to stay short. -->
				<div
					class="flex gap-1 {doable ? '' : 'short:hidden'}"
					role="img"
					aria-label="{chore.stars} {chore.stars === 1 ? 'star' : 'stars'}"
				>
					{#each { length: stars } as _, i (i)}
						<StarIcon
							variant={chore.status === 'pending' ? 'outline' : 'gold'}
							class="size-14 short:size-6 tablet:size-8"
						/>
					{/each}
				</div>
			{/if}
		</div>
	</div>

	<div
		class="flex flex-col gap-4 landscape:basis-2/5 short:w-24 short:shrink-0 short:!basis-auto short:gap-2 short:md:w-32 tablet:gap-2 portrait:tablet:basis-2/5"
	>
		{#if doable}
			{#if chore.status === 'rejected'}
				<p class="page-enter text-lead font-bold text-ink-muted" data-testid="gentle-note">
					Let&rsquo;s try that one again 💛
				</p>
			{/if}
			<Button
				size="kid"
				class="min-h-32 w-full text-title short:min-h-tap-kid short:px-2 short:text-body tablet:min-h-tap-kid tablet:px-4 tablet:text-lead"
				data-testid="did-it"
				onclick={() => card && ondone(chore, card)}
			>
				I did it!
			</Button>
		{:else if chore.status === 'pending'}
			<div
				class="page-enter flex min-h-32 items-center justify-center gap-4 rounded-card bg-star-soft px-4 text-center short:min-h-14 short:gap-2 short:px-2 tablet:min-h-tap-kid"
				data-testid="waiting"
			>
				<span class="text-title tablet:text-lead" aria-hidden="true">⏳</span>
				<p class="text-body leading-tight font-extrabold short:text-caption">
					Waiting for grown-up
				</p>
			</div>
			{@render undoButton()}
		{:else}
			<div
				class="page-enter flex min-h-32 items-center justify-center gap-4 rounded-card bg-star px-8 text-on-star short:min-h-14 short:gap-2 short:px-2 tablet:min-h-tap-kid tablet:px-4"
				data-testid="done"
			>
				<span class="text-title leading-none short:text-body tablet:text-lead" aria-hidden="true"
					>✓</span
				>
				<p class="text-title leading-none font-extrabold short:text-body tablet:text-lead">Done!</p>
			</div>
			{@render undoButton()}
		{/if}
	</div>
</article>

{#snippet undoButton()}
	{#if showUndo && undoStartedAt !== null}
		<button
			type="button"
			data-testid="undo"
			class="undo page-enter relative inline-flex min-h-tap-kid w-full items-center justify-center gap-4 overflow-hidden rounded-chip border-4 border-line bg-surface px-8 text-lead font-extrabold text-ink short:px-3 short:text-caption tablet:px-4 tablet:text-body"
			onclick={() => onundo(chore)}
		>
			<span
				class="countdown absolute inset-0 origin-left bg-accent-soft"
				style:animation-duration="{UNDO_WINDOW_MS}ms"
				aria-hidden="true"
			></span>
			<span class="relative inline-flex items-center gap-2 whitespace-nowrap">
				<!-- An icon, not the "↩" glyph: that character is not in the UI font, and the first-ever
				     system-font fallback lookup cost the first tap ~60 ms of layout at 4x CPU throttle. -->
				<svg
					viewBox="0 0 24 24"
					aria-hidden="true"
					class="size-8 shrink-0 fill-none stroke-current"
					stroke-width="3"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<path d="M9 14L4 9l5-5" />
					<path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
				</svg>
				Undo
			</span>
			<span class="relative tabular-nums" data-testid="undo-seconds">
				{undoSecondsLeft(undoStartedAt, now)}
			</span>
		</button>
	{/if}
{/snippet}

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
