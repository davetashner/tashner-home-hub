<script lang="ts">
	interface Step {
		/** Button text, e.g. `-1 hr`. */
		text: string;
		delta: number;
	}
	interface Props {
		label: string;
		value: string;
		steps: Step[];
		onstep: (delta: number) => void;
		testid?: string;
	}
	/** Touch-friendly value picker: big buttons either side of the value (no tiny native inputs). */
	let { label, value, steps, onstep, testid }: Props = $props();
	const before = $derived(steps.filter((s) => s.delta < 0));
	const after = $derived(steps.filter((s) => s.delta > 0));
</script>

<div role="group" aria-label={label} class="flex items-center gap-2" data-testid={testid}>
	{#each before as s (s.delta)}
		<button type="button" class="step" aria-label="{label} {s.text}" onclick={() => onstep(s.delta)}
			>{s.text}</button
		>
	{/each}
	<span class="min-w-0 flex-1 text-center text-body font-extrabold" aria-live="polite">{value}</span
	>
	{#each after as s (s.delta)}
		<button type="button" class="step" aria-label="{label} {s.text}" onclick={() => onstep(s.delta)}
			>{s.text}</button
		>
	{/each}
</div>

<style>
	.step {
		min-width: var(--spacing-tap);
		min-height: var(--spacing-tap);
		padding: 0 0.75rem;
		border: 2px solid var(--color-line);
		border-radius: var(--radius-control);
		background: var(--color-surface-raised);
		font-size: var(--text-caption);
		font-weight: 800;
		cursor: pointer;
		touch-action: manipulation;
		transition: transform var(--duration-quick) var(--ease-out-soft);
	}
	.step:active {
		transform: scale(0.94);
		transition-duration: var(--duration-instant);
	}
	.step:focus-visible {
		outline: 4px solid var(--color-accent);
		outline-offset: 2px;
	}
</style>
