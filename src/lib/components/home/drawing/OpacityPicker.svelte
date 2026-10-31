<script lang="ts">
	import { OPACITY_STEPS } from '#lib/domain/drawing-colors.js';

	interface Props {
		value: number;
		onpick: (alpha: number) => void;
	}
	let { value, onpick }: Props = $props();
</script>

<div class="flex flex-wrap items-center gap-3" role="group" aria-label="Opacity">
	{#each OPACITY_STEPS as a (a)}
		<button
			type="button"
			class="flex size-tap-kid items-center justify-center rounded-chip border-4 bg-surface text-caption font-extrabold {value ===
			a
				? 'border-accent bg-accent-soft'
				: 'border-line'}"
			aria-pressed={value === a}
			aria-label="{Math.round(a * 100)} percent opacity"
			data-testid="draw-opacity"
			data-opacity={a}
			onclick={() => onpick(a)}
		>
			{Math.round(a * 100)}%
		</button>
	{/each}
</div>
