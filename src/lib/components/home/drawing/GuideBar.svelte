<script lang="ts">
	// hub-t27j.12: the step controls of a "How to draw" guide, beside the board like the prompt card.
	let {
		title,
		label,
		first,
		last,
		onback,
		onnext,
		ondone
	}: {
		title: string;
		label: string;
		first: boolean;
		last: boolean;
		onback: () => void;
		onnext: () => void;
		ondone: () => void;
	} = $props();

	const chip =
		'flex min-h-tap-kid min-w-tap-kid items-center justify-center rounded-control border-2 border-control-line bg-control px-4 text-body font-extrabold text-ink transition-transform duration-75 active:scale-95 disabled:opacity-40';
</script>

<div
	class="flex w-full shrink-0 flex-wrap items-center gap-3 rounded-card border-2 border-line bg-surface px-4 py-2"
	data-testid="draw-guide-bar"
>
	<p class="min-w-0 flex-1 text-body font-extrabold landscape:w-full landscape:flex-none">
		{title}: <span data-testid="draw-guide-step">{label}</span>
	</p>
	<button
		type="button"
		class={chip}
		disabled={first}
		onclick={onback}
		data-testid="draw-guide-back"
	>
		Back
	</button>
	<button type="button" class={chip} disabled={last} onclick={onnext} data-testid="draw-guide-next">
		Next
	</button>
	<button type="button" class={chip} onclick={ondone} data-testid="draw-guide-done">Done</button>
</div>
