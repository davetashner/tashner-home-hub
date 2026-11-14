<script lang="ts">
	// Today's drawing prompt (hub-cn7.27): a card at the top of the tool panel, beside the board (never over it) with Shuffle and Hide.
	// Start it (hub-585) shows only when the prompt has a half-done sketch to put on the board.
	let {
		prompt,
		onstart = null,
		onshuffle,
		ondismiss
	}: {
		prompt: string;
		onstart?: (() => void) | null;
		onshuffle: () => void;
		ondismiss: () => void;
	} = $props();

	const chip =
		'flex min-h-tap-kid min-w-tap-kid items-center justify-center rounded-control border-2 border-control-line bg-control px-4 text-body font-extrabold text-ink transition-transform duration-75 active:scale-95';
</script>

<div
	class="flex w-full shrink-0 flex-wrap items-center gap-3 rounded-card border-2 border-line bg-surface px-4 py-2"
	data-testid="draw-prompt-banner"
>
	<p
		class="min-w-0 flex-1 text-body font-extrabold landscape:w-full landscape:flex-none"
		data-testid="draw-prompt"
	>
		{prompt}
	</p>
	{#if onstart}
		<button type="button" class={chip} onclick={onstart} data-testid="draw-prompt-start">
			Start it
		</button>
	{/if}
	<button type="button" class={chip} onclick={onshuffle} data-testid="draw-prompt-shuffle">
		Shuffle
	</button>
	<button
		type="button"
		class={chip}
		onclick={ondismiss}
		aria-label="Hide today's prompt"
		data-testid="draw-prompt-hide"
	>
		Hide
	</button>
</div>
