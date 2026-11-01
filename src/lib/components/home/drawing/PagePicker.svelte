<script lang="ts">
	import Button from '#lib/components/ui/Button.svelte';
	import { PAGE_IDS, PAGE_LABELS, pageDrawing, type PageId } from '#lib/domain/drawing-pages.js';
	import { toolBtn as btn } from './tool-btn.js';

	interface Props {
		page: PageId | null;
		onpick: (id: PageId | null) => void;
		onback: () => void;
	}
	let { page, onpick, onback }: Props = $props();

	/** Small SVG path for a page button. */
	const pagePreview = (id: PageId): string =>
		pageDrawing(id)
			.flat()
			.map((c) =>
				c[0] === 'E'
					? `M${c[1] - c[3]} ${c[2]}a${c[3]} ${c[4]} 0 1 0 ${2 * c[3]} 0a${c[3]} ${c[4]} 0 1 0 ${-2 * c[3]} 0`
					: c.join(' ')
			)
			.join(' ');
</script>

<p class="w-full text-body font-extrabold">Coloring pages</p>
<div class="flex flex-wrap gap-3" role="group" aria-label="Pages" data-testid="draw-pages">
	{#each PAGE_IDS as id (id)}
		<button
			type="button"
			class="{btn} flex-col gap-1 {page === id
				? 'border-accent bg-accent-soft'
				: 'border-line bg-surface'}"
			aria-label={PAGE_LABELS[id]}
			aria-pressed={page === id}
			data-testid="draw-page"
			data-page={id}
			onclick={() => onpick(id)}
		>
			<svg viewBox="0 0 1000 700" class="h-tap-kid w-32" aria-hidden="true">
				<path
					d={pagePreview(id)}
					fill="none"
					stroke="currentColor"
					stroke-width="22"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
		</button>
	{/each}
</div>
<button
	type="button"
	class="{btn} border-line bg-surface"
	data-testid="draw-page-none"
	onclick={() => onpick(null)}>Blank page</button
>
<Button variant="ghost" onclick={onback} data-testid="draw-pages-close">Back</Button>
