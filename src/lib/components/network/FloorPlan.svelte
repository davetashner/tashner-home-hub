<script lang="ts">
	import {
		planBounds,
		toneOf,
		type DeviceView,
		type Floor,
		type NetLayout,
		type Tone
	} from '#lib/domain/net-layout.js';

	interface Props {
		layout: NetLayout;
		devices: DeviceView[];
		checkedAt: number | null;
		floor: Floor;
		now: number;
		selected: string | null;
		onselect: (id: string) => void;
	}
	let { layout, devices, checkedAt, floor, now, selected, onselect }: Props = $props();

	const box = $derived(planBounds(layout));
	const rooms = $derived(
		[...layout.rooms].filter((r) => r.floor === floor).sort((a, b) => b.w * b.h - a.w * a.h)
	);
	const byId = $derived(new Map(devices.map((d) => [d.id, d])));
	const placed = $derived(
		layout.placements
			.filter((p) => byId.has(p.id))
			.map((p) => ({ ...p, dev: byId.get(p.id)!, other: p.floor !== floor }))
	);
	const fill: Record<Tone, string> = {
		up: 'fill-success',
		down: 'fill-danger',
		stale: 'fill-star-pending',
		unknown: 'fill-ink-muted'
	};
</script>

<svg
	viewBox="{box.x} {box.y} {box.w} {box.h}"
	class="block h-auto w-full"
	role="img"
	aria-label="Floor plan with device status"
	data-testid="net-floorplan"
>
	{#each rooms as r (r.id)}
		<rect
			x={r.x}
			y={r.y}
			width={r.w}
			height={r.h}
			class="fill-surface stroke-ink-muted"
			stroke-width="0.2"
		/>
		<text x={r.x + 0.6} y={r.y + 1.5} font-size="1" class="fill-ink-muted font-bold uppercase"
			>{r.name}</text
		>
	{/each}
	{#each placed as p (p.id)}
		{@const tone = toneOf(p.dev.state, checkedAt, now)}
		<!-- A device on the other floor shows faded, so the bonus room's gear still reads as "above". -->
		<g
			role="button"
			tabindex={p.other ? -1 : 0}
			aria-label="{p.dev.name}: {tone}"
			class="cursor-pointer outline-none {p.other ? 'opacity-40' : ''}"
			data-testid="net-pin"
			data-tone={tone}
			onclick={() => onselect(p.id)}
			onkeydown={(e) =>
				(e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onselect(p.id))}
		>
			<!-- an invisible 3 ft disc keeps the pin easy to hit at any zoom -->
			<circle cx={p.x} cy={p.y} r="1.6" class="fill-surface opacity-0" />
			<circle
				cx={p.x}
				cy={p.y}
				r="0.9"
				class="{fill[tone]} {selected === p.id ? 'stroke-ink' : 'stroke-surface'}"
				stroke-width={selected === p.id ? 0.4 : 0.25}
			/>
			<text x={p.x} y={p.y + 2} font-size="0.85" text-anchor="middle" class="fill-ink font-bold"
				>{p.dev.name}</text
			>
		</g>
	{/each}
	{#if rooms.length === 0}
		<text x={box.x + 1} y={box.y + 2} font-size="1" class="fill-ink-muted"
			>Nothing drawn on this floor.</text
		>
	{/if}
</svg>
