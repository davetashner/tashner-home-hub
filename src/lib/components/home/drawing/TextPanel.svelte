<script lang="ts">
	import { TEXT_SIZES, TEXT_SIZE_LABELS, type TextSize } from '#lib/domain/drawing-text.js';

	interface Props {
		size: TextSize;
		editing: boolean;
		onsize: (size: TextSize) => void;
		ondone: () => void;
	}
	let { size, editing, onsize, ondone }: Props = $props();

	const btn =
		'flex min-h-tap-kid min-w-tap-kid items-center justify-center rounded-control border-2 px-4 text-body font-extrabold transition-transform duration-75 active:scale-95';
</script>

<div
	class="flex w-full flex-wrap gap-3"
	role="group"
	aria-label="Text size"
	data-testid="draw-text-panel"
>
	{#each TEXT_SIZES as k (k)}
		<button
			type="button"
			class="{btn} {size === k ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}"
			aria-pressed={size === k}
			data-testid="draw-text-size"
			data-size={k}
			onclick={() => onsize(k)}>{TEXT_SIZE_LABELS[k]}</button
		>
	{/each}
	{#if editing}
		<button
			type="button"
			class="{btn} border-accent bg-accent text-on-accent"
			data-testid="draw-text-done"
			onpointerdown={(e) => e.preventDefault()}
			onclick={ondone}>Done</button
		>
	{/if}
</div>
