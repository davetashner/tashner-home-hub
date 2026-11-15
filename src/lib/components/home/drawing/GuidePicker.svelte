<script lang="ts">
	import Button from '#lib/components/ui/Button.svelte';
	import { GUIDE_IDS, GUIDE_LABELS, type GuideId } from '#lib/domain/drawing-guide.js';
	import { toolBtn as btn } from './tool-btn.js';

	// hub-t27j.12: pick a "How to draw" guide.
	let { onpick, onback }: { onpick: (id: GuideId) => void; onback: () => void } = $props();
</script>

<p class="w-full text-body font-extrabold">How to draw</p>
<div class="flex flex-wrap gap-3" role="group" aria-label="Guides" data-testid="draw-guides">
	{#each GUIDE_IDS as id (id)}
		<button
			type="button"
			class="{btn} border-line bg-surface"
			data-testid="draw-guide-pick"
			data-guide={id}
			onclick={() => onpick(id)}>{GUIDE_LABELS[id]}</button
		>
	{/each}
</div>
<Button variant="ghost" onclick={onback} data-testid="draw-guides-close">Back</Button>
