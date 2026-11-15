<script lang="ts">
	// A grown-up's challenge for one kid (hub-t27j.11): shown in place of the daily prompt. Done clears
	// it; Later hides it for this visit only. It sits beside the board like the daily prompt.
	let {
		name,
		text,
		ondone,
		onlater
	}: {
		name: string;
		text: string;
		ondone: () => void;
		onlater: () => void;
	} = $props();

	const chip =
		'flex min-h-tap-kid min-w-tap-kid items-center justify-center rounded-control border-2 border-control-line bg-control px-4 text-body font-extrabold text-ink transition-transform duration-75 active:scale-95';
</script>

<div
	class="flex w-full shrink-0 flex-wrap items-center gap-3 rounded-card border-2 border-line bg-surface px-4 py-2"
	data-testid="draw-challenge"
>
	<p class="min-w-0 flex-1 text-body font-extrabold landscape:w-full landscape:flex-none">
		<span class="text-ink-muted">A challenge for {name}:</span>
		<span data-testid="draw-challenge-text">{text}</span>
	</p>
	<button type="button" class={chip} onclick={ondone} data-testid="draw-challenge-done">
		Done
	</button>
	<button type="button" class={chip} onclick={onlater} data-testid="draw-challenge-later">
		Later
	</button>
</div>
