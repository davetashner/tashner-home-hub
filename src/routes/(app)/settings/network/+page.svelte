<script lang="ts">
	import { onMount } from 'svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import FloorPlan from '#lib/components/network/FloorPlan.svelte';
	import {
		roomAt,
		shortSpan,
		statusLine,
		toneOf,
		type DeviceView,
		type Floor,
		type NetLayout,
		type Tone
	} from '#lib/domain/net-layout.js';

	interface View {
		devices: DeviceView[];
		checkedAt: number | null;
		layout: NetLayout | null;
	}

	let view = $state<View | null>(null);
	let failed = $state(false);
	let floor = $state<Floor>(1);
	let selected = $state<string | null>(null);
	let now = $state(Date.now());

	async function load() {
		const res = await fetch('/api/network').catch(() => null);
		if (res?.ok) {
			view = (await res.json()) as View;
			failed = false;
		} else failed = true;
	}

	onMount(() => {
		void load();
		const poll = setInterval(() => void load(), 60_000);
		const tick = setInterval(() => (now = Date.now()), 15_000);
		return () => (clearInterval(poll), clearInterval(tick));
	});

	const tones = $derived(
		new Map((view?.devices ?? []).map((d) => [d.id, toneOf(d.state, view?.checkedAt ?? null, now)]))
	);
	const answering = $derived([...tones.values()].filter((t) => t === 'up').length);
	const down = $derived([...tones.values()].filter((t) => t === 'down').length);
	const hasUpstairs = $derived(view?.layout?.rooms.some((r) => r.floor === 2) ?? false);
	const placementOf = (id: string) => view?.layout?.placements.find((p) => p.id === id) ?? null;
	function roomName(id: string): string {
		const p = placementOf(id);
		if (!p || !view?.layout) return 'Not on the plan';
		return roomAt(view.layout, p.x, p.y, p.floor)?.name ?? 'Outside';
	}
	function pick(id: string) {
		selected = selected === id ? null : id;
		const p = placementOf(id);
		if (p && selected) floor = p.floor;
	}
	const dot: Record<Tone, string> = {
		up: 'bg-success',
		down: 'bg-danger',
		stale: 'bg-star-pending',
		unknown: 'bg-ink-muted'
	};
	const word: Record<Tone, string> = {
		up: 'Up',
		down: 'Down',
		stale: 'Stale',
		unknown: 'Not checked'
	};
	const toggle =
		'min-h-tap rounded-control border-2 px-6 text-body font-bold transition-transform duration-75 active:scale-95';
</script>

<svelte:head>
	<title>Network · Settings · Home Hub</title>
</svelte:head>

<section class="mx-auto flex w-full max-w-5xl flex-col gap-6 p-8 max-sm:p-3 short:gap-4 short:p-3">
	<div class="flex flex-col gap-1">
		<h1 class="text-headline font-extrabold">Network</h1>
		{#if view && view.devices.length}
			<p class="text-body text-ink-muted" data-testid="net-summary">
				{answering} of {view.devices.length} answering{down ? ` · ${down} down` : ''}
				{#if view.checkedAt}· checked {shortSpan(now - view.checkedAt)} ago{/if}
			</p>
		{/if}
	</div>

	{#if failed && !view}
		<Card
			><p class="text-body">
				Couldn't load the network status. It will try again in a minute.
			</p></Card
		>
	{:else if view && view.devices.length === 0}
		<Card data-testid="net-empty">
			<p class="text-title font-bold">No devices listed yet</p>
			<p class="text-body text-ink-muted">
				Add the router, mesh points and the gear you care about, and the hub checks them every
				minute.
			</p>
		</Card>
	{:else if view}
		{#if view.layout}
			<Card class="flex flex-col gap-4">
				{#if hasUpstairs}
					<div class="flex flex-wrap gap-3" role="group" aria-label="Floor">
						{#each [[1, 'Main floor'], [2, 'Upstairs']] as const as [f, label] (f)}
							<button
								type="button"
								aria-pressed={floor === f}
								onclick={() => (floor = f)}
								class="{toggle} {floor === f
									? 'border-accent bg-accent-soft'
									: 'border-control-line bg-control'}">{label}</button
							>
						{/each}
					</div>
				{/if}
				<div class="overflow-x-auto">
					<FloorPlan
						layout={view.layout}
						devices={view.devices}
						checkedAt={view.checkedAt}
						{floor}
						{now}
						{selected}
						onselect={pick}
					/>
				</div>
			</Card>
		{/if}

		<ul class="grid grid-cols-2 gap-3 max-sm:grid-cols-1 portrait:grid-cols-1" aria-label="Devices">
			{#each view.devices as d (d.id)}
				{@const tone = tones.get(d.id) ?? 'unknown'}
				<li>
					<button
						type="button"
						aria-expanded={selected === d.id}
						onclick={() => pick(d.id)}
						data-testid="net-device"
						data-tone={tone}
						class="flex min-h-tap w-full items-start gap-4 rounded-card bg-surface-raised p-4 text-left shadow-raised transition-transform duration-75 active:scale-95 {selected ===
						d.id
							? 'ring-2 ring-accent'
							: ''}"
					>
						<span class="mt-2 size-4 shrink-0 rounded-full {dot[tone]}" aria-hidden="true"></span>
						<span class="flex min-w-0 flex-col gap-1">
							<span class="text-title font-bold">{d.name}</span>
							<span class="text-body text-ink-muted">
								<span class="sr-only">{word[tone]}: </span>{statusLine(
									d.state,
									view.checkedAt,
									now
								)}
							</span>
							<span class="text-caption text-ink-muted">{roomName(d.id)} · {d.ip}</span>
							{#if selected === d.id && d.state?.nest}
								{@const n = d.state.nest}
								<span class="text-caption" data-testid="net-nest">
									{n.role === 'root' ? 'Router' : 'Mesh point'} ({n.model}) · internet port {n.wanLink
										? 'linked'
										: 'unplugged'} · LAN port {n.lanLink ? 'linked' : 'unplugged'}{n.online === null
										? ''
										: n.online
											? ' · online'
											: ' · no internet'}{n.software ? ` · software ${n.software}` : ''}
								</span>
							{/if}
						</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</section>
