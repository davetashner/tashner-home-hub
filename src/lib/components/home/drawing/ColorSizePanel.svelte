<script lang="ts">
	import OpacityPicker from './OpacityPicker.svelte';
	import {
		BRUSH_SCALE,
		BRUSH_SIZES,
		DRAW_COLORS,
		FIXED_WIDTH,
		isInkToken,
		type BrushSize,
		type DrawColor,
		type InkColor
	} from '#lib/domain/drawing.js';
	import { toolBtn as btn } from './tool-btn.js';

	interface Props {
		color: InkColor;
		/** The eraser is on, so no color shows as chosen. */
		eraser: boolean;
		recent: string[];
		alpha: number;
		size: BrushSize;
		onpick: (c: InkColor) => void;
		onmore: () => void;
		onalpha: (a: number) => void;
		onsize: (b: BrushSize) => void;
		/** Which groups to show: each tool's panel shows only its own options. */
		colors?: boolean;
		opacity?: boolean;
		sizes?: boolean;
	}
	let {
		color,
		eraser,
		recent,
		alpha,
		size,
		onpick,
		onmore,
		onalpha,
		onsize,
		colors = true,
		opacity = true,
		sizes = true
	}: Props = $props();

	// Full class names so Tailwind can see them.
	const swatch: Record<DrawColor, string> = {
		'draw-black': 'bg-draw-black',
		'draw-red': 'bg-draw-red',
		'draw-orange': 'bg-draw-orange',
		'draw-green': 'bg-draw-green',
		'draw-blue': 'bg-draw-blue',
		'draw-purple': 'bg-draw-purple'
	};
</script>

{#if colors}
	<div class="flex flex-wrap gap-3" role="group" aria-label="Ink color">
		{#each DRAW_COLORS as c (c)}
			<button
				type="button"
				class="size-tap-kid rounded-chip border-4 {swatch[c]} {color === c && !eraser
					? 'border-accent'
					: 'border-line'}"
				aria-label={c.replace('draw-', '')}
				aria-pressed={color === c && !eraser}
				data-testid="draw-color"
				data-color={c}
				onclick={() => onpick(c)}
			></button>
		{/each}
		<button
			type="button"
			class="{btn} border-line bg-surface"
			data-testid="draw-more-colors"
			onclick={onmore}>More colors</button
		>
	</div>
	{#if recent.length}
		<div class="flex flex-wrap gap-3" role="group" aria-label="Recent colors">
			{#each recent as c (c)}
				<button
					type="button"
					class="size-tap-kid rounded-chip border-4 {color === c && !eraser
						? 'border-accent'
						: 'border-line'} {isInkToken(c) ? swatch[c] : ''}"
					style:background-color={isInkToken(c) ? undefined : c}
					aria-label="Recent color"
					data-testid="draw-recent"
					onclick={() => onpick(c)}
				></button>
			{/each}
		</div>
	{/if}
{/if}
{#if opacity}
	<OpacityPicker value={alpha} onpick={onalpha} />
{/if}
{#if sizes}
	<div class="flex flex-wrap gap-3" role="group" aria-label="Brush size">
		{#each BRUSH_SIZES as b (b)}
			<button
				type="button"
				class="{btn} flex-col gap-1 {size === b
					? 'border-accent bg-accent-soft'
					: 'border-line bg-surface'}"
				aria-pressed={size === b}
				aria-label={b}
				data-testid="draw-size"
				data-size={b}
				onclick={() => onsize(b)}
			>
				<span
					class="rounded-full bg-ink"
					style:width="{FIXED_WIDTH * BRUSH_SCALE[b]}px"
					style:height="{FIXED_WIDTH * BRUSH_SCALE[b]}px"
				></span>
			</button>
		{/each}
	</div>
{/if}
