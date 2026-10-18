<script lang="ts">
	import {
		flexNote,
		isDoable,
		undoSecondsLeft,
		UNDO_WINDOW_MS,
		type KidChore
	} from '#lib/domain/kid-chores.js';
	import StarIcon from './StarIcon.svelte';

	/**
	 * One To-Do as a compact checklist row (hub-3yg): checkbox, icon, title. The whole row is the
	 * tap target (>= 96px); tapping a checked row takes it back while the undo window is open.
	 */
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
	const habit = $derived(chore.kind === 'habit');
	const approved = $derived(chore.status === 'approved');

	// Pink outline for Star Jobs, purple for habits; a finished row takes the soft fill.
	const look = $derived(
		habit
			? approved
				? 'border-habit-line bg-habit-soft'
				: 'border-habit-line bg-surface-raised'
			: approved
				? 'border-job-line bg-job-soft'
				: 'border-job-line bg-surface-raised'
	);
</script>

<article
	bind:this={card}
	data-testid="chore-card"
	data-status={chore.status}
	data-kind={chore.kind ?? 'star_job'}
	class="row relative flex min-h-tap-kid items-center gap-3 rounded-card border-4 px-3 py-2 tablet:gap-2 tablet:px-2 {look}"
>
	{#if doable}
		<button
			type="button"
			data-testid="did-it"
			aria-label="Mark done: {chore.title}"
			class="hit absolute -inset-1 z-10 rounded-card"
			onclick={() => card && ondone(chore, card)}
		></button>
	{:else if showUndo && undoStartedAt !== null}
		<button
			type="button"
			data-testid="undo"
			aria-label="Undo: {chore.title}"
			class="hit absolute -inset-1 z-10 rounded-card"
			onclick={() => onundo(chore)}
		></button>
	{/if}

	<!-- Checkbox: an empty box (pink / purple outline), a filled star, an outlined star or a check. -->
	{#if chore.status === 'pending'}
		<span
			class="mark grid size-14 shrink-0 place-items-center tablet:size-10"
			data-testid="waiting"
		>
			<StarIcon variant="job-outline" class="size-14 tablet:size-10" />
			<span class="sr-only">Waiting for grown-up</span>
		</span>
	{:else if approved}
		<span class="mark grid size-14 shrink-0 place-items-center tablet:size-10" data-testid="done">
			{#if habit}
				<span
					class="grid size-12 place-items-center rounded-control bg-habit text-body leading-none font-extrabold text-on-accent tablet:size-9"
					aria-hidden="true">✓</span
				>
			{:else}
				<StarIcon variant="job" class="size-14 tablet:size-10" />
			{/if}
			<span class="sr-only">Done</span>
		</span>
	{:else}
		<span
			class="mark size-12 shrink-0 rounded-control border-4 bg-surface-raised tablet:size-9 {habit
				? 'border-habit'
				: 'border-job'}"
			aria-hidden="true"
		></span>
	{/if}

	<span
		class="shrink-0 text-headline leading-none short:text-title tablet:text-title {doable
			? ''
			: 'opacity-70'}"
		aria-hidden="true"
	>
		{chore.icon ?? '⭐'}
	</span>

	<div class="flex min-w-0 grow flex-col">
		<h3
			class="min-w-0 text-body leading-tight font-extrabold break-words short:text-caption tablet:text-caption"
		>
			{chore.title}
		</h3>
		{#if chore.status === 'rejected'}
			<p class="page-enter text-caption font-bold text-ink-muted" data-testid="gentle-note">
				Let&rsquo;s try that one again 💛
			</p>
		{:else if chore.flex}
			<p class="text-caption font-bold text-ink-muted" data-testid="flex-due">
				{flexNote(chore.flex)}
			</p>
		{/if}
	</div>

	{#if showUndo && undoStartedAt !== null}
		<span
			class="page-enter inline-flex shrink-0 items-center gap-1 rounded-chip bg-surface px-3 py-1 text-caption font-extrabold text-ink"
		>
			<svg
				viewBox="0 0 24 24"
				aria-hidden="true"
				class="size-6 shrink-0 fill-none stroke-current"
				stroke-width="3"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<path d="M9 14L4 9l5-5" />
				<path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
			</svg>
			Undo
			<span class="tabular-nums" data-testid="undo-seconds"
				>{undoSecondsLeft(undoStartedAt, now)}</span
			>
		</span>
		<span
			class="countdown absolute inset-x-6 bottom-1 h-1 origin-left rounded-chip bg-accent"
			style:animation-duration="{UNDO_WINDOW_MS}ms"
			aria-hidden="true"
		></span>
	{:else if habit}
		<!-- A habit earns no stars itself; it counts toward the day's habit star. -->
		<span class="shrink-0 text-caption font-extrabold text-habit" data-testid="habit-tag"
			>Habit</span
		>
	{:else if doable}
		<span
			class="flex shrink-0 items-center gap-1 text-caption font-extrabold text-job"
			role="img"
			aria-label="{chore.stars} {chore.stars === 1 ? 'star' : 'stars'}"
		>
			+{chore.stars}
			<StarIcon variant="job" class="size-6" />
		</span>
	{/if}
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
	.row {
		transition: transform var(--duration-quick) var(--ease-out-soft);
	}
	.row:active {
		transform: scale(0.97);
		transition-duration: var(--duration-instant);
	}
	.hit {
		cursor: pointer;
	}
	.hit:focus-visible {
		outline: 4px solid var(--color-accent);
		outline-offset: -4px;
	}
	@media (prefers-reduced-motion: reduce) {
		.countdown {
			animation: none;
		}
	}
</style>
