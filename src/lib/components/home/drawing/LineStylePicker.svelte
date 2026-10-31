<script lang="ts">
	// Solid / dashed / dotted outline for shapes, lines and arrows (hub-cn7.17).
	import { LINE_STYLES, LINE_STYLE_LABELS, type LineStyle } from '#lib/domain/drawing-dash.js';

	let { value, onpick }: { value: LineStyle; onpick: (v: LineStyle) => void } = $props();

	const dashArray: Record<LineStyle, string | undefined> = {
		solid: undefined,
		dashed: '9 7',
		dotted: '0.1 7'
	};
</script>

<div
	class="flex flex-wrap gap-3"
	role="group"
	aria-label="Line style"
	data-testid="draw-line-styles"
>
	{#each LINE_STYLES as v (v)}
		<button
			type="button"
			class="flex min-h-tap-kid min-w-tap-kid items-center justify-center rounded-control border-2 px-4 transition-transform duration-75 active:scale-95 {value ===
			v
				? 'border-accent bg-accent-soft'
				: 'border-line bg-surface'}"
			aria-label={LINE_STYLE_LABELS[v]}
			aria-pressed={value === v}
			data-testid="draw-line-style"
			data-style={v}
			onclick={() => onpick(v)}
		>
			<svg viewBox="0 0 44 12" class="h-tap-kid w-tap-kid" aria-hidden="true">
				<line
					x1="4"
					y1="6"
					x2="40"
					y2="6"
					stroke="currentColor"
					stroke-width="4"
					stroke-linecap="round"
					stroke-dasharray={dashArray[v]}
				/>
			</svg>
		</button>
	{/each}
</div>
