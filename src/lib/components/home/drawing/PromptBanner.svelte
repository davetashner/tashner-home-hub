<script lang="ts">
	// Today's drawing prompt (hub-cn7.27): a small card over the top of the page with Shuffle and Hide.
	let {
		prompt,
		onshuffle,
		ondismiss
	}: { prompt: string; onshuffle: () => void; ondismiss: () => void } = $props();

	const chip =
		'flex min-h-tap-kid min-w-tap-kid items-center justify-center rounded-control border-2 border-control-line bg-control px-4 text-body font-extrabold text-ink transition-transform duration-75 active:scale-95';
</script>

<div
	class="pointer-events-none absolute inset-x-3 top-3 z-10 flex justify-center"
	data-testid="draw-prompt-banner"
>
	<div
		class="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-3 rounded-card border-2 border-line bg-surface px-4 py-2 shadow-raised"
	>
		<p class="text-body font-extrabold" data-testid="draw-prompt">{prompt}</p>
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
</div>
