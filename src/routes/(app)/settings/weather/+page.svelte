<script lang="ts">
	import { onMount } from 'svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import type { GeoResult, WeatherLocation, WeatherUnit } from '#lib/domain/weather.js';

	let loc = $state<WeatherLocation | null>(null);
	let query = $state('');
	let results = $state<GeoResult[]>([]);
	let lat = $state('');
	let lon = $state('');
	let message = $state('');
	let searched = $state(false);

	onMount(() => {
		void fetch('/api/settings/weather')
			.then(async (res) => {
				if (res.ok) loc = ((await res.json()) as { location: WeatherLocation | null }).location;
			})
			.catch(() => {});
	});

	async function save(next: {
		lat: number | string;
		lon: number | string;
		name: string;
		unit: WeatherUnit;
	}) {
		const before = loc;
		message = '';
		try {
			const res = await fetch('/api/settings/weather', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(next)
			});
			if (!res.ok) throw new Error(String(res.status));
			loc = ((await res.json()) as { location: WeatherLocation }).location;
			results = [];
		} catch {
			loc = before;
			message = 'Could not save. Check the numbers and try again.';
		}
	}

	async function search() {
		message = '';
		searched = false;
		try {
			const res = await fetch(`/api/settings/weather/search?q=${encodeURIComponent(query)}`);
			results = res.ok ? ((await res.json()) as { results: GeoResult[] }).results : [];
		} catch {
			results = [];
			message = 'Search needs the internet. Enter latitude and longitude instead.';
		}
		searched = true;
	}

	function setUnit(unit: WeatherUnit) {
		if (!loc || loc.unit === unit) return;
		loc = { ...loc, unit }; // optimistic
		void save(loc);
	}

	async function turnOff() {
		const before = loc;
		loc = null;
		const res = await fetch('/api/settings/weather', {
			method: 'DELETE',
			headers: { 'content-type': 'application/json' },
			body: '{}'
		}).catch(() => null);
		if (!res?.ok) {
			loc = before;
			message = 'Could not turn weather off. Try again.';
		}
	}

	const field =
		'min-h-tap w-full rounded-control border-2 border-line bg-surface px-6 text-body text-ink';
</script>

<svelte:head>
	<title>Weather · Settings · Home Hub</title>
</svelte:head>

<section class="mx-auto flex w-full max-w-4xl flex-col gap-8 p-8 max-sm:p-3">
	<h1 class="text-headline font-extrabold">Weather</h1>
	<Card>
		{#if loc}
			<p class="text-title font-bold" data-testid="weather-current">{loc.name || 'Home'}</p>
			<p class="text-body text-ink-muted">Shown on the home screen. Data from Open-Meteo.</p>
			<div class="mt-4 flex flex-wrap gap-3">
				{#each ['F', 'C'] as const as u (u)}
					<button
						type="button"
						aria-pressed={loc.unit === u}
						onclick={() => setUnit(u)}
						class="min-h-tap min-w-tap rounded-control border-2 px-6 text-body font-bold transition-transform duration-75 active:scale-95 {loc.unit ===
						u
							? 'border-accent bg-accent-soft'
							: 'border-line bg-surface-raised'}">°{u}</button
					>
				{/each}
				<button
					type="button"
					onclick={turnOff}
					class="min-h-tap rounded-control border-2 border-line bg-surface-raised px-6 text-body transition-transform duration-75 active:scale-95"
					>Turn off weather</button
				>
			</div>
		{:else}
			<p class="text-body text-ink-muted">
				Weather is off. Search for a city or postal code, or enter coordinates.
			</p>
		{/if}
	</Card>

	<form
		class="flex flex-col gap-3"
		onsubmit={(e) => {
			e.preventDefault();
			void search();
		}}
	>
		<label class="flex flex-col gap-2">
			<span class="text-caption text-ink-muted">City or postal code</span>
			<input class={field} type="search" autocomplete="off" bind:value={query} />
		</label>
		<button
			type="submit"
			class="min-h-tap self-start rounded-control bg-accent px-6 text-body font-bold text-on-accent transition-transform duration-75 active:scale-95"
			>Search</button
		>
	</form>
	<ul class="flex flex-col gap-3" aria-label="Places">
		{#each results as r (r.lat + ',' + r.lon)}
			<li>
				<button
					type="button"
					onclick={() => save({ ...r, unit: loc?.unit ?? 'F' })}
					class="min-h-tap w-full rounded-control border-2 border-line bg-surface-raised px-6 py-3 text-left text-body font-bold transition-transform duration-75 active:scale-95"
					>{r.name}</button
				>
			</li>
		{/each}
		{#if searched && results.length === 0}
			<li class="text-body text-ink-muted">No places found.</li>
		{/if}
	</ul>

	<form
		class="flex flex-wrap items-end gap-3"
		onsubmit={(e) => {
			e.preventDefault();
			void save({ lat, lon, name: query.trim(), unit: loc?.unit ?? 'F' });
		}}
	>
		<label class="flex min-w-0 flex-1 flex-col gap-2">
			<span class="text-caption text-ink-muted">Latitude</span>
			<input class={field} inputmode="decimal" bind:value={lat} />
		</label>
		<label class="flex min-w-0 flex-1 flex-col gap-2">
			<span class="text-caption text-ink-muted">Longitude</span>
			<input class={field} inputmode="decimal" bind:value={lon} />
		</label>
		<button
			type="submit"
			class="min-h-tap rounded-control border-2 border-line bg-surface-raised px-6 text-body font-bold transition-transform duration-75 active:scale-95"
			>Use coordinates</button
		>
	</form>
	{#if message}<p role="alert" class="text-body text-danger">{message}</p>{/if}
</section>
