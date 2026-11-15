<script lang="ts">
	// Fold-the-paper monster (hub-t27j.9): the "folded" paper over the earlier parts, the guides
	// around the band being drawn, and the ta-da badge after the reveal.
	import { fly, scale } from 'svelte/transition';
	import { bandSpan, coverSpan, isDrawing, type MonsterGame } from '#lib/domain/drawing-monster.js';

	let { game, height }: { game: MonsterGame; height: number } = $props();

	const cover = $derived(coverSpan(game, height));
	const band = $derived(isDrawing(game) ? bandSpan(game.turns, game.turn, height) : null);
</script>

{#if cover}
	<div
		class="pointer-events-none absolute inset-x-0 flex items-end justify-center border-b-2 border-dashed border-accent bg-accent-soft pb-3"
		style:top="{cover.top}px"
		style:height="{cover.height}px"
		out:fly={{ y: -height, duration: 700 }}
		data-testid="draw-monster-cover"
		data-cover-height={Math.round(cover.height)}
	>
		<p class="text-body font-extrabold text-ink-muted">Folded! No peeking</p>
	</div>
{/if}
{#if band}
	<svg
		class="pointer-events-none absolute inset-0 size-full text-accent"
		aria-hidden="true"
		data-testid="draw-monster-band"
		data-band-top={Math.round(band.top)}
		data-band-height={Math.round(band.height)}
	>
		<rect
			x="0"
			y={band.top}
			width="100%"
			height={band.height}
			fill="none"
			stroke="currentColor"
			stroke-width="4"
			stroke-dasharray="16 10"
		/>
	</svg>
{/if}
{#if game.phase === 'revealed'}
	<p
		class="pointer-events-none absolute top-4 left-1/2 -translate-x-1/2 rounded-chip border-2 border-accent bg-surface px-6 py-2 text-title font-extrabold shadow-raised"
		in:scale={{ start: 0.5, duration: 500 }}
		out:scale={{ duration: 200 }}
		data-testid="draw-monster-tada"
	>
		Ta-da!
	</p>
{/if}
