<script lang="ts">
	/**
	 * A posted drawing (hub-t27j.21). With extra Wiggle frames it boils: the frames are stacked and
	 * only their opacity flips at the board's wiggle rate. Reduced motion, or no extra frames, shows
	 * the still image alone.
	 */
	import { onMount } from 'svelte';
	import { WIGGLE_FPS } from '#lib/domain/drawing-wiggle.js';

	interface Props {
		/** The still image. */
		src: string;
		/** Extra jitter frames; the loop is [src, ...frames]. */
		frames?: readonly string[];
		alt: string;
		class?: string;
		/** Classes for the frame stack's wrapper (only used when there are extra frames). */
		wrapClass?: string;
	}
	let { src, frames = [], alt, class: cls = '', wrapClass = '' }: Props = $props();

	let still = $state(true);
	let at = $state(0);
	const all = $derived([src, ...frames]);

	onMount(() => {
		const calm = window.matchMedia('(prefers-reduced-motion: reduce)');
		const update = () => (still = calm.matches);
		update();
		calm.addEventListener('change', update);
		return () => calm.removeEventListener('change', update);
	});

	$effect(() => {
		const n = all.length;
		if (still || n < 2) {
			at = 0;
			return;
		}
		const timer = setInterval(() => (at = (at + 1) % n), 1000 / WIGGLE_FPS);
		return () => clearInterval(timer);
	});
</script>

{#if frames.length === 0}
	<img {src} {alt} class={cls} />
{:else}
	<span
		class="grid [&>*]:col-start-1 [&>*]:row-start-1 {wrapClass}"
		data-testid="wiggle-img"
		data-wiggle={still ? 'still' : 'live'}
		data-frame={at}
	>
		{#each all as url, i (url)}
			<img
				src={url}
				alt={i === 0 ? alt : ''}
				aria-hidden={i === 0 ? undefined : true}
				class={cls}
				style:opacity={i === at ? 1 : 0}
			/>
		{/each}
	</span>
{/if}
