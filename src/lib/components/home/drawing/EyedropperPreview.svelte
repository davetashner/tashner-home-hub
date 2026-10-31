<script lang="ts">
	// hub-cn7.14: the swatch that follows the finger while the eyedropper is dragged. It sits above
	// the touch point so the finger never hides it; only transform moves (no layout work).
	let { x, y, color }: { x: number; y: number; color: string } = $props();
</script>

<div
	class="pointer-events-none absolute top-0 left-0 size-tap-kid rounded-full border-4 border-ink shadow-raised"
	style:background-color={color}
	style:transform="translate({x}px, {y}px) translate(-50%, -150%)"
	aria-hidden="true"
	data-testid="draw-dropper-preview"
	data-color={color}
></div>
