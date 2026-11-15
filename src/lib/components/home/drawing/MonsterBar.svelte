<script lang="ts">
	// Fold-the-paper monster (hub-t27j.9): whose turn it is, and the Next player / Reveal! button.
	import {
		canNext,
		canReveal,
		isDrawing,
		turnLabel,
		type MonsterGame
	} from '#lib/domain/drawing-monster.js';
	import { toolBtn as btn } from './tool-btn.js';

	let {
		game,
		onnext,
		onreveal,
		onend
	}: { game: MonsterGame; onnext: () => void; onreveal: () => void; onend: () => void } = $props();
</script>

<div
	class="flex w-full flex-wrap items-center gap-3 rounded-card border-2 border-accent bg-accent-soft p-3"
	data-testid="draw-monster-bar"
	data-turn={game.turn}
	data-phase={game.phase}
>
	<p class="w-full text-body font-extrabold" role="status" data-testid="draw-monster-status">
		{turnLabel(game)}
	</p>
	{#if canNext(game)}
		<button
			type="button"
			class="{btn} border-accent bg-surface"
			data-testid="draw-monster-next"
			onclick={onnext}>Next player</button
		>
	{:else if canReveal(game)}
		<button
			type="button"
			class="{btn} border-accent bg-surface"
			data-testid="draw-monster-reveal"
			onclick={onreveal}>Reveal!</button
		>
	{/if}
	<button
		type="button"
		class="{btn} border-line bg-surface"
		data-testid="draw-monster-end"
		onclick={onend}>{isDrawing(game) ? 'Stop game' : 'Done'}</button
	>
</div>
