<script lang="ts">
	/**
	 * Time-lapse player (hub-cn7.22): sits over the board, plays `items` back in order and point by
	 * point, and tells the host what to paint each frame (`render`) so the board's own paint path
	 * draws every kind of item. Read-only: it never changes `items`. A tap anywhere skips to the end.
	 */
	import { onMount } from 'svelte';
	import {
		buildSchedule,
		frameAt,
		itemsAt,
		nextSpeed,
		type ReplaySpeed
	} from '#lib/domain/drawing-replay.js';
	import type { DrawItem } from '#lib/domain/drawing.js';

	interface Props {
		items: readonly DrawItem[];
		/** Paint exactly these items (finished ones plus the stroke in progress). */
		render: (items: DrawItem[]) => void;
		/** The replay ended or was skipped: show the finished drawing. */
		ondone: () => void;
	}
	let { items, render, ondone }: Props = $props();

	let speed = $state<ReplaySpeed>(1);
	const schedule = $derived(buildSchedule(items));
	let elapsed = 0;
	let raf = 0;
	let last = 0;
	let over = false;

	function finish() {
		if (over) return;
		over = true;
		cancelAnimationFrame(raf);
		ondone();
	}

	function tick(now: number) {
		elapsed += (now - last) * speed;
		last = now;
		const frame = frameAt(schedule, elapsed);
		if (frame.finished) return finish();
		render(itemsAt(items, frame));
		raf = requestAnimationFrame(tick);
	}

	onMount(() => {
		last = performance.now();
		render([]);
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	});

	const btn =
		'min-h-tap-kid min-w-tap-kid rounded-control border-2 border-line bg-surface-raised px-4 text-body font-extrabold active:scale-95';
</script>

<div
	class="absolute inset-0 z-10 touch-none"
	role="button"
	tabindex="0"
	aria-label="Replay: tap to skip to the end"
	data-testid="draw-replay"
	onpointerdown={finish}
	onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && finish()}
>
	<div class="absolute bottom-3 left-3 flex gap-3">
		<button
			type="button"
			class={btn}
			aria-label="Replay speed {speed}x"
			data-testid="draw-replay-speed"
			onpointerdown={(e) => e.stopPropagation()}
			onclick={() => (speed = nextSpeed(speed))}>{speed}x</button
		>
		<button
			type="button"
			class={btn}
			data-testid="draw-replay-skip"
			onpointerdown={(e) => e.stopPropagation()}
			onclick={finish}>Skip</button
		>
	</div>
</div>
