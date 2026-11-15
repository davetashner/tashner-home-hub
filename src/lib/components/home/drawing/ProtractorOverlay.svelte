<script lang="ts">
	// hub-t27j.24: the protractor overlay. A plain element above the canvases, never ink. Its body lets
	// pointers through to the canvas (a stroke can start right at its center); only the move grip (left end) and the turn handle (on the arc) take touches. One finger on the grip moves, two move and turn.
	import { SvelteMap } from 'svelte/reactivity';
	import {
		aimProtractor,
		moveProtractor,
		protractorMarks,
		rotateProtractor,
		type Protractor
	} from '#lib/domain/drawing-protractor.js';
	import type { Pt } from '#lib/domain/drawing-ruler.js';

	let {
		protractor,
		toBoard,
		onchange
	}: {
		protractor: Protractor;
		/** Client coordinates to board CSS px (accounts for zoom and pan). */
		toBoard: (clientX: number, clientY: number) => Pt;
		onchange: (p: Protractor) => void;
	} = $props();

	const fingers = new SvelteMap<number, Pt>();
	let turning = -1;
	const marks = protractorMarks();
	const D = Math.PI / 180;

	// SVG box is 2r x r; the flat side is the bottom edge, the center sits at its middle.
	const pos = (deg: number, radius: number) => ({
		x: protractor.r + Math.cos(deg * D) * radius,
		y: protractor.r - Math.sin(deg * D) * radius
	});

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
			const [a1, b1] = first ? [now, b] : [a, now];
			const turn = Math.atan2(b1.y - a1.y, b1.x - a1.x) - Math.atan2(b.y - a.y, b.x - a.x) || 0;
			const moved = moveProtractor(
				protractor,
				(a1.x + b1.x) / 2 - (a.x + b.x) / 2,
				(a1.y + b1.y) / 2 - (a.y + b.y) / 2
			);
			onchange(rotateProtractor(moved, turn));
		} else {
			onchange(moveProtractor(protractor, now.x - before.x, now.y - before.y));
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
		onchange(aimProtractor(protractor, toBoard(e.clientX, e.clientY)));
	}
	function turnEnd() {
		turning = -1;
	}
</script>

<!-- The transform origin is the center of the flat side, so it turns about the point strokes snap from. -->
<div
	class="pointer-events-none absolute"
	style:left="{protractor.cx}px"
	style:top="{protractor.cy}px"
	style:width="{protractor.r * 2}px"
	style:height="{protractor.r}px"
	style:transform-origin="50% 100%"
	style:transform="translate(-50%, -100%) rotate({protractor.angle}rad)"
	data-testid="draw-protractor"
	data-angle={protractor.angle.toFixed(3)}
	data-cx={protractor.cx.toFixed(1)}
	data-cy={protractor.cy.toFixed(1)}
>
	<svg
		class="absolute inset-0 size-full overflow-visible text-ink-muted"
		viewBox="0 0 {protractor.r * 2} {protractor.r}"
		aria-hidden="true"
	>
		<path
			d="M 0 {protractor.r} A {protractor.r} {protractor.r} 0 0 1 {protractor.r *
				2} {protractor.r} Z"
			class="fill-accent-soft stroke-accent opacity-60"
			stroke-width="4"
		/>
		{#each marks as m (m.deg)}
			{@const a = pos(m.deg, protractor.r)}
			{@const b = pos(m.deg, protractor.r - (m.label ? 44 : 24))}
			<line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="currentColor" stroke-width="3" />
			{#if m.label}
				{@const t = pos(m.deg, protractor.r - 80)}
				<text
					x={t.x}
					y={t.y}
					text-anchor="middle"
					dominant-baseline="middle"
					fill="currentColor"
					class="text-body font-bold"
					transform="rotate({90 - m.deg} {t.x} {t.y})">{m.deg}</text
				>
			{/if}
		{/each}
	</svg>
	<button
		type="button"
		class="pointer-events-auto absolute bottom-0 left-0 flex size-tap-kid -translate-x-1/2 translate-y-1/2 touch-none items-center justify-center rounded-chip border-4 border-accent bg-surface text-title font-extrabold shadow-raised"
		aria-label="Move protractor"
		data-testid="draw-protractor-move"
		onpointerdown={grab}
		onpointermove={drag}
		onpointerup={release}
		onpointercancel={release}><span aria-hidden="true">✥</span></button
	>
	<button
		type="button"
		class="pointer-events-auto absolute right-0 bottom-0 flex size-tap-kid translate-x-1/2 translate-y-1/2 touch-none items-center justify-center rounded-chip border-4 border-accent bg-surface text-title font-extrabold shadow-raised"
		aria-label="Turn protractor"
		data-testid="draw-protractor-turn"
		onpointerdown={turnStart}
		onpointermove={turnMove}
		onpointerup={turnEnd}
		onpointercancel={turnEnd}><span aria-hidden="true">↻</span></button
	>
</div>
