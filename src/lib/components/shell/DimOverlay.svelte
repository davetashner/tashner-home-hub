<script lang="ts">
	/**
	 * Evening dimming (SLP-5): a fixed black layer over the page, opacity = 1 - brightness. Only
	 * opacity animates, so the Pi never filters the whole page (and its WebGL wave) on each repaint.
	 * It sits above page content but below sheets, dialogs, banners and the photo frame (z-20+).
	 */
	let { brightness }: { brightness: number } = $props();
</script>

<div class="dim" style:opacity={1 - brightness} aria-hidden="true" data-testid="dim-overlay"></div>

<style>
	.dim {
		position: fixed;
		inset: 0;
		z-index: 15;
		pointer-events: none;
		background: var(--color-dim-overlay);
		opacity: 0;
		transition: opacity var(--duration-crossfade) var(--ease-out-soft);
	}
</style>
