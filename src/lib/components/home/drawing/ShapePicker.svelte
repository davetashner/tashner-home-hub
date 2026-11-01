<script lang="ts">
	import Button from '#lib/components/ui/Button.svelte';
	import LineStylePicker from './LineStylePicker.svelte';
	import { ALL_SHAPES, SHAPE_LABELS, shapeParts, type ShapeKind } from '#lib/domain/drawing.js';
	import type { LineStyle } from '#lib/domain/drawing-dash.js';
	import { toolBtn as btn } from './tool-btn.js';

	interface Props {
		filled: boolean;
		lineStyle: LineStyle;
		shapeKind: ShapeKind | null;
		onfill: (filled: boolean) => void;
		onlinestyle: (v: LineStyle) => void;
		/** Pick a shape; null goes back to the pen. */
		onpick: (k: ShapeKind | null) => void;
	}
	let { filled, lineStyle, shapeKind, onfill, onlinestyle, onpick }: Props = $props();

	/** SVG path data for a picker preview, so the buttons show the real shape. */
	function previewPath(kind: ShapeKind): string {
		const parts = shapeParts({ shape: kind, x0: 6, y0: 6, x1: 38, y1: 38 });
		return parts
			.flatMap((p) => p.cmds)
			.map((c) =>
				c[0] === 'E'
					? `M${c[1] - c[3]} ${c[2]}a${c[3]} ${c[4]} 0 1 0 ${2 * c[3]} 0a${c[3]} ${c[4]} 0 1 0 ${-2 * c[3]} 0`
					: c.join(' ')
			)
			.join(' ');
	}
</script>

<p class="w-full text-body font-extrabold">Shapes and stamps</p>
<div class="flex flex-wrap gap-3" role="group" aria-label="Fill">
	{#each [false, true] as f (f)}
		<button
			type="button"
			class="{btn} {filled === f ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}"
			aria-pressed={filled === f}
			data-testid="draw-fill"
			data-filled={f}
			onclick={() => onfill(f)}>{f ? 'Filled' : 'Outline'}</button
		>
	{/each}
</div>
<LineStylePicker value={lineStyle} onpick={onlinestyle} />
<div class="flex flex-wrap gap-3" role="group" aria-label="Shapes" data-testid="draw-shapes">
	{#each ALL_SHAPES as k (k)}
		<button
			type="button"
			class="{btn} flex-col gap-1 {shapeKind === k
				? 'border-accent bg-accent-soft'
				: 'border-line bg-surface'}"
			aria-label={SHAPE_LABELS[k]}
			aria-pressed={shapeKind === k}
			data-testid="draw-shape"
			data-shape={k}
			onclick={() => onpick(k)}
		>
			<svg viewBox="0 0 44 44" class="size-tap-kid" aria-hidden="true">
				<path
					d={previewPath(k)}
					fill={filled ? 'currentColor' : 'none'}
					stroke="currentColor"
					stroke-width="3"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
		</button>
	{/each}
</div>
<Button variant="ghost" onclick={() => onpick(null)} data-testid="draw-shape-off"
	>Back to pen</Button
>
