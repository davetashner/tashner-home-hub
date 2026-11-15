<script lang="ts">
	// What the paint bucket paints: solid color or a pattern (hub-t27j.2). Lists FILL_STYLES, so
	// a new style (a gradient, say) shows up here once it is added to that list and to `preview`.
	import {
		FILL_STYLES,
		FILL_STYLE_LABELS,
		PATTERN_IDS,
		patternCovers,
		type FillStyle,
		type PatternId
	} from '#lib/domain/drawing-pattern.js';

	let { value, onpick }: { value: FillStyle; onpick: (v: FillStyle) => void } = $props();

	/** A 12 x 12 grid of squares standing in for a pattern's ink (the tile, drawn twice over). */
	const PREVIEW = 12;
	const cells = (id: PatternId) => {
		const out: { x: number; y: number }[] = [];
		for (let y = 0; y < PREVIEW; y++)
			for (let x = 0; x < PREVIEW; x++)
				if (patternCovers(id, (((x + 0.5) / PREVIEW) * 2) % 1, (((y + 0.5) / PREVIEW) * 2) % 1))
					out.push({ x, y });
		return out;
	};
	const isPattern = (s: FillStyle): s is PatternId =>
		(PATTERN_IDS as readonly string[]).includes(s);
</script>

<div
	class="flex flex-wrap gap-3"
	role="group"
	aria-label="Fill style"
	data-testid="draw-fill-styles"
>
	{#each FILL_STYLES as s (s)}
		<button
			type="button"
			class="flex min-h-tap-kid min-w-tap-kid items-center justify-center rounded-control border-2 px-4 transition-transform duration-75 active:scale-95 {value ===
			s
				? 'border-accent bg-accent-soft'
				: 'border-line bg-surface'}"
			aria-label={FILL_STYLE_LABELS[s]}
			aria-pressed={value === s}
			data-testid="draw-fill-style"
			data-style={s}
			onclick={() => onpick(s)}
		>
			<svg viewBox="0 0 {PREVIEW} {PREVIEW}" class="h-tap-kid w-tap-kid" aria-hidden="true">
				{#if isPattern(s)}
					{#each cells(s) as c (`${c.x}-${c.y}`)}
						<rect x={c.x} y={c.y} width="1" height="1" fill="currentColor" />
					{/each}
				{:else}
					<rect width={PREVIEW} height={PREVIEW} fill="currentColor" />
				{/if}
			</svg>
		</button>
	{/each}
</div>
