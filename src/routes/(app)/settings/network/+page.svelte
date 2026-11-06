<script lang="ts">
	import { onMount } from 'svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import FloorPlan from '#lib/components/network/FloorPlan.svelte';
	import NetworkSetup from '#lib/components/network/NetworkSetup.svelte';
	import {
		roomAt,
		shortSpan,
		statusLine,
		toneOf,
		withPlacement,
		type DeviceView,
		type Floor,
		type NetLayout,
		type Tone
	} from '#lib/domain/net-layout.js';
	import type { SeenHost } from '#lib/domain/lan-monitor.js';

	interface View {
		devices: DeviceView[];
		checkedAt: number | null;
		layout: NetLayout | null;
		unknown: SeenHost[];
	}

	let view = $state<View | null>(null);
	let failed = $state(false);
	let floor = $state<Floor>(1);
	let selected = $state<string | null>(null);
	let now = $state(Date.now());
	/** The device being moved: the next tap on the plan sets where it is. */
	let placing = $state<string | null>(null);
	let placeError = $state('');
	let setup = $state<ReturnType<typeof NetworkSetup>>();

	async function ignore(ip: string) {
		if (!view) return;
		const before = view.unknown;
		view.unknown = before.filter((h) => h.ip !== ip); // optimistic
		const res = await fetch('/api/network/ignore', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ ip })
		}).catch(() => null);
		if (!res?.ok && view) view.unknown = before;
	}

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
	async function placeAt(x: number, y: number) {
		if (!view?.layout || !placing) return;
		const before = view.layout;
		const next = withPlacement(before, placing, x, y, floor);
		view.layout = next; // optimistic: the pin moves at once
		placing = null;
		placeError = '';
		const res = await fetch('/api/network/layout', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(next)
		}).catch(() => null);
		if (!res?.ok) {
			if (view?.layout === next) view.layout = before;
			placeError = "Couldn't save the new spot. Try again.";
		}
	}
	const placingName = $derived(view?.devices.find((d) => d.id === placing)?.name ?? '');
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
				{#if placing}
					<div class="flex flex-wrap items-center gap-3" role="status" data-testid="net-placing">
						<p class="text-body font-bold">
							Tap where {placingName} is. Switch floors first if it's upstairs.
						</p>
						<button
							type="button"
							class="{toggle} border-control-line bg-control"
							onclick={() => (placing = null)}>Cancel</button
						>
					</div>
				{/if}
				{#if placeError}<p class="text-body text-danger" role="alert">{placeError}</p>{/if}
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
						onplace={placing ? placeAt : undefined}
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
					{#if selected === d.id && view.layout}
						<button
							type="button"
							class="{toggle} mt-2 border-control-line bg-control"
							onclick={() => (placing = d.id)}
							data-testid="net-move">Move on the plan</button
						>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
	{#if view}
		{#if view.unknown.length}
			<Card class="flex flex-col gap-3" data-testid="net-unknown">
				<h2 class="text-title font-bold">New on the network</h2>
				<p class="text-body text-ink-muted">
					These answered a scan of the home network but aren't in the list. Add the ones you care
					about; ignore the rest.
				</p>
				<ul class="flex flex-col gap-3">
					{#each view.unknown as h (h.ip)}
						<li class="flex flex-wrap items-center gap-3">
							<span class="min-w-0 flex-1 text-body">
								<span class="font-bold">{h.ip}</span>
								<span class="text-ink-muted">
									· port {h.port} · first seen {shortSpan(now - h.firstSeen)} ago</span
								>
							</span>
							<button
								type="button"
								class="{toggle} border-control-line bg-control"
								onclick={() => setup?.addHost(h.ip, h.port)}>Add</button
							>
							<button
								type="button"
								class="{toggle} border-control-line bg-control"
								onclick={() => ignore(h.ip)}>Ignore</button
							>
						</li>
					{/each}
				</ul>
			</Card>
		{/if}
		<NetworkSetup bind:this={setup} devices={view.devices} onchange={load} />
	{/if}
</section>
