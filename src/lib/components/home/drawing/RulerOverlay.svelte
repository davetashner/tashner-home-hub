<script lang="ts">
	// hub-t27j.16: the ruler overlay. It is a plain element above the canvases, never ink. The body lets
	// pointers through to the canvas (so a stroke can start right at its edge); only the move grip and
	// the rotate handle take touches. One finger on the grip moves, two fingers on it move and turn.
	import { SvelteMap } from 'svelte/reactivity';
	import {
		aimRuler,
		moveRuler,
		twoFingers,
		type Pt,
		type Ruler
	} from '#lib/domain/drawing-ruler.js';

	let {
		ruler,
		toBoard,
		onchange
	}: {
		ruler: Ruler;
		/** Client coordinates to board CSS px (accounts for zoom and pan). */
		toBoard: (clientX: number, clientY: number) => Pt;
		onchange: (r: Ruler) => void;
	} = $props();

	const fingers = new SvelteMap<number, Pt>();
	let turning = -1;

	const ticks = $derived(
		Array.from({ length: Math.floor(ruler.len / 40) + 1 }, (_, i) => {
			const x = i * 40 + (ruler.len % 40) / 2;
			return { x, h: i % 5 === 0 ? 36 : 20 };
		})
	);

	function capture(e: PointerEvent) {
		try {
			(e.currentTarget as Element).setPointerCapture(e.pointerId);
		} catch {
			// Synthetic pointers (tests) are not active pointers; real ones always capture.
		}
	}

	function grab(e: PointerEvent) {
		e.preventDefault();
		capture(e);
		fingers.set(e.pointerId, toBoard(e.clientX, e.clientY));
	}

	function drag(e: PointerEvent) {
		const before = fingers.get(e.pointerId);
		if (!before) return;
		const now = toBoard(e.clientX, e.clientY);
		if (fingers.size >= 2) {
			const [a, b] = [...fingers.values()];
			const first = [...fingers.keys()][0] === e.pointerId;
			onchange(twoFingers(ruler, a, b, first ? now : a, first ? b : now));
		} else {
			onchange(moveRuler(ruler, now.x - before.x, now.y - before.y));
		}
		fingers.set(e.pointerId, now);
	}

	function release(e: PointerEvent) {
		fingers.delete(e.pointerId);
	}

	function turnStart(e: PointerEvent) {
		e.preventDefault();
		capture(e);
		turning = e.pointerId;
	}
	function turnMove(e: PointerEvent) {
		if (e.pointerId !== turning) return;
		const p = toBoard(e.clientX, e.clientY);
		onchange(aimRuler(ruler, p));
	}
	function turnEnd() {
		turning = -1;
	}
</script>

<div
	class="pointer-events-none absolute"
	style:left="{ruler.cx}px"
	style:top="{ruler.cy}px"
	style:width="{ruler.len}px"
	style:height="{ruler.thick}px"
	style:transform="translate(-50%, -50%) rotate({ruler.angle}rad)"
	data-testid="draw-ruler"
	data-angle={ruler.angle.toFixed(3)}
	data-cx={ruler.cx.toFixed(1)}
	data-cy={ruler.cy.toFixed(1)}
>
	<div class="absolute inset-0 rounded-chip border-4 border-accent bg-accent-soft opacity-60"></div>
	<svg class="absolute inset-0 size-full text-ink-muted" aria-hidden="true">
		{#each ticks as t, ti (ti)}
			<line x1={t.x} y1="0" x2={t.x} y2={t.h} stroke="currentColor" stroke-width="3" />
		{/each}
	</svg>
	<button
		type="button"
		class="pointer-events-auto absolute top-1/2 left-1/2 flex size-tap-kid -translate-x-1/2 -translate-y-1/2 touch-none items-center justify-center rounded-chip border-4 border-accent bg-surface text-title font-extrabold shadow-raised"
		aria-label="Move ruler"
		data-testid="draw-ruler-move"
		onpointerdown={grab}
		onpointermove={drag}
		onpointerup={release}
		onpointercancel={release}><span aria-hidden="true">✥</span></button
	>
	<button
		type="button"
		class="pointer-events-auto absolute top-1/2 right-0 flex size-tap-kid -translate-y-1/2 touch-none items-center justify-center rounded-chip border-4 border-accent bg-surface text-title font-extrabold shadow-raised"
		aria-label="Turn ruler"
		data-testid="draw-ruler-turn"
		onpointerdown={turnStart}
		onpointermove={turnMove}
		onpointerup={turnEnd}
		onpointercancel={turnEnd}><span aria-hidden="true">↻</span></button
	>
</div>
