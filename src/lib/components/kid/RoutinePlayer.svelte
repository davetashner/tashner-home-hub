<script lang="ts">
	import { currentStep, type KidRoutine } from '#lib/domain/routines.js';
	import RoutineIcon from './RoutineIcon.svelte';
	import { toBody } from './portal.js';

	interface Props {
		routine: KidRoutine;
		/** A step was finished (0-based index); the page saves it. */
		ondone: (index: number) => void;
		onclose: () => void;
	}
	let { routine, ondone, onclose }: Props = $props();

	const total = $derived(routine.steps.length);
	const index = $derived(currentStep(routine.done, total));
	const state = (i: number) => (i < routine.done ? 'done' : i === index ? 'current' : 'todo');
	const STATE = {
		done: 'bg-success text-on-accent',
		current: 'bg-accent-soft text-accent ring-4 ring-accent',
		todo: 'bg-surface-sunken text-ink-muted'
	};
	const step = $derived(index === null ? null : routine.steps[index]);
</script>

<div
	use:toBody
	role="dialog"
	aria-modal="true"
	aria-label={routine.name}
	data-testid="routine-player"
	class="fixed inset-0 z-30 flex flex-col items-center gap-8 bg-surface p-10 portrait:p-8 short:gap-3 short:p-4"
>
	<header class="flex w-full items-center justify-between gap-6">
		<h2 class="text-title leading-none font-extrabold">{routine.name}</h2>
		<button
			type="button"
			onclick={onclose}
			data-testid="routine-close"
			class="min-h-tap-kid min-w-tap-kid rounded-card bg-surface-raised px-8 text-lead font-bold shadow-raised transition-transform duration-75 active:scale-95"
		>
			Close
		</button>
	</header>

	{#if step && index !== null}
		{#key index}
			<div
				class="step flex min-h-0 grow flex-col items-center justify-center gap-8 short:flex-row short:gap-6"
				data-testid="routine-step"
			>
				<div class="size-64 text-accent portrait:size-96 short:size-20 tablet:landscape:size-40">
					<RoutineIcon name={step.icon} />
				</div>
				<div class="flex flex-col items-center gap-8 short:items-start short:gap-1">
					<p class="text-center text-headline leading-tight font-extrabold">{step.label}</p>
					<p class="text-lead text-ink-muted">Step {index + 1} of {total}</p>
				</div>
			</div>
		{/key}
		<button
			type="button"
			onclick={() => ondone(index)}
			data-testid="routine-done"
			class="min-h-tap-kid w-full max-w-3xl rounded-card bg-success px-12 py-8 text-headline font-extrabold text-on-accent shadow-raised transition-transform duration-75 active:scale-95 short:py-2"
		>
			Done
		</button>
	{:else}
		<div
			class="step flex min-h-0 grow flex-col items-center justify-center gap-8"
			data-testid="routine-complete"
		>
			<p class="text-display leading-none" aria-hidden="true">🎉</p>
			<p class="text-center text-headline leading-tight font-extrabold">{routine.name} done!</p>
		</div>
	{/if}

	<ol
		class="flex flex-wrap justify-center gap-4 short:gap-2"
		aria-label="Steps"
		data-testid="routine-progress"
	>
		{#each routine.steps as s, i (i)}
			<li
				class="size-16 rounded-full p-3 short:size-12 short:p-2 {STATE[state(i)]}"
				data-state={state(i)}
			>
				<RoutineIcon name={s.icon} />
			</li>
		{/each}
	</ol>
</div>

<style>
	.step {
		animation: step-in var(--duration-base) var(--ease-spring) both;
	}
	@keyframes step-in {
		from {
			opacity: 0;
			transform: scale(0.9);
		}
	}
</style>
