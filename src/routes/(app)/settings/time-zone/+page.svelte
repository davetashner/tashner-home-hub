<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import Card from '#lib/components/ui/Card.svelte';
	import { formatClock } from '#lib/domain/clock.js';
	import {
		canonicalZone,
		listTimeZones,
		offsetLabel,
		resolveTimeZone,
		runtimeZone,
		searchZones,
		zoneLabel
	} from '#lib/domain/time-zone.js';

	const zones = listTimeZones();
	let zone = $state(resolveTimeZone(page.data.timeZone, runtimeZone()));
	let query = $state('');
	let message = $state('');
	let now = $state(Date.now());

	const results = $derived(searchZones(zones, query));
	const current = $derived(zoneLabel(zone));
	const time = $derived(formatClock(new Date(now), { timeZone: zone }).time);
	const isCurrent = (z: string) => canonicalZone(z) === canonicalZone(zone);

	onMount(() => {
		void fetch('/api/settings/household')
			.then(async (res) => {
				if (!res.ok) return;
				const body = (await res.json()) as { timeZone?: unknown };
				zone = resolveTimeZone(body.timeZone, zone);
			})
			.catch(() => {});
		const timer = setInterval(() => (now = Date.now()), 15_000);
		return () => clearInterval(timer);
	});

	function pick(next: string) {
		if (isCurrent(next)) return;
		const before = zone;
		// Optimistic: the page shows the new zone before the save lands.
		zone = next;
		message = '';
		void fetch('/api/settings/household', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ timeZone: next })
		})
			.then(async (res) => {
				if (!res.ok) throw new Error(String(res.status));
				await invalidateAll();
			})
			.catch(() => {
				zone = before;
				message = 'Could not save. Try again.';
			});
	}
</script>

<svelte:head>
	<title>Time zone · Settings · Home Hub</title>
</svelte:head>

<section class="mx-auto flex w-full max-w-4xl flex-col gap-8 p-8 max-sm:p-3">
	<h1 class="text-headline font-extrabold">Time zone</h1>
	<Card>
		<div class="flex flex-wrap items-center justify-between gap-6">
			<div class="flex flex-col gap-1">
				<p class="text-title font-bold" data-testid="tz-current">{current.city}</p>
				<p class="text-body text-ink-muted">
					{[current.region, offsetLabel(zone, now)].filter(Boolean).join(' · ')}
				</p>
			</div>
			<p class="text-title font-bold tabular-nums">{time}</p>
		</div>
		<p class="mt-4 text-body text-ink-muted">
			Decides when chores reset each day and where calendar times without a zone belong.
		</p>
	</Card>
	<label class="flex flex-col gap-2">
		<span class="text-caption text-ink-muted">Find a city or region</span>
		<input
			class="min-h-tap w-full rounded-control border-2 border-line bg-surface px-6 text-body text-ink"
			type="search"
			autocomplete="off"
			placeholder="Chicago, London, Tokyo…"
			bind:value={query}
		/>
	</label>
	<ul class="flex flex-col gap-3" aria-label="Time zones">
		{#each results as z (z)}
			{@const label = zoneLabel(z)}
			<li>
				<button
					type="button"
					aria-pressed={isCurrent(z)}
					onclick={() => pick(z)}
					class="flex min-h-tap w-full items-center justify-between gap-4 rounded-control border-2 px-6 py-3 text-left transition-transform duration-75 active:scale-95 {isCurrent(
						z
					)
						? 'border-accent bg-accent-soft'
						: 'border-line bg-surface-raised'}"
				>
					<span class="flex flex-col">
						<span class="text-body font-bold">{label.city}</span>
						{#if label.region}<span class="text-caption text-ink-muted">{label.region}</span>{/if}
					</span>
					<span class="text-caption text-ink-muted tabular-nums">{offsetLabel(z, now)}</span>
				</button>
			</li>
		{:else}
			<li class="text-body text-ink-muted">No time zone matches “{query}”.</li>
		{/each}
	</ul>
	{#if message}<p role="alert" class="text-body text-danger">{message}</p>{/if}
</section>
