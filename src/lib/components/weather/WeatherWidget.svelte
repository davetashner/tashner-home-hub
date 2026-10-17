<script lang="ts">
	import { onMount } from 'svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import {
		dayLabel,
		describeWeather,
		isOutOfDate,
		unitSymbol,
		type WeatherSnapshot
	} from '#lib/domain/weather.js';

	interface Payload {
		enabled: boolean;
		location?: { name: string };
		snapshot?: WeatherSnapshot | null;
	}

	let view = $state<Payload | null>(null);
	let now = $state(Date.now());

	async function load() {
		try {
			const res = await fetch('/api/weather');
			if (res.ok) view = (await res.json()) as Payload;
		} catch {
			// offline: keep whatever is already showing
		}
		now = Date.now();
	}

	onMount(() => {
		void load();
		// the first load may only warm the server cache, so look again shortly
		const soon = setTimeout(() => void load(), 4000);
		const timer = setInterval(() => void load(), 10 * 60 * 1000);
		return () => {
			clearTimeout(soon);
			clearInterval(timer);
		};
	});

	const snap = $derived(view?.snapshot ?? null);
	const cur = $derived(snap ? describeWeather(snap.current.code, snap.current.isDay) : null);
	const sym = $derived(snap ? unitSymbol(snap.unit) : '');
</script>

{#if view?.enabled}
	<Card data-testid="weather-widget">
		{#if snap && cur}
			<div class="flex flex-wrap items-center gap-8 portrait:gap-4">
				<div class="flex items-center gap-4">
					<span class="text-display leading-none" aria-hidden="true">{cur.icon}</span>
					<div class="flex flex-col">
						<span class="text-headline font-extrabold tabular-nums" data-testid="weather-temp"
							>{snap.current.temp}{sym}</span
						>
						<span class="text-body text-ink-muted">{cur.label}</span>
						<span class="text-caption text-ink-muted"
							>Feels {snap.current.feelsLike}° · Wind {snap.current.wind}</span
						>
					</div>
				</div>
				<ul class="flex flex-1 justify-between gap-4" aria-label="Forecast">
					{#each snap.days as day, i (day.date)}
						{@const d = describeWeather(day.code)}
						<li class="flex flex-col items-center gap-1" title={d.label}>
							<span class="text-caption text-ink-muted">{dayLabel(day.date, i)}</span>
							<span class="text-title leading-none" aria-hidden="true">{d.icon}</span>
							<span class="text-caption font-bold tabular-nums">{day.high}°</span>
							<span class="text-caption text-ink-muted tabular-nums">{day.low}°</span>
						</li>
					{/each}
				</ul>
			</div>
			{#if isOutOfDate(snap, now)}
				<p class="mt-2 text-caption text-ink-muted">Weather may be out of date.</p>
			{/if}
		{:else}
			<p class="text-body text-ink-muted">
				Getting the weather for {view.location?.name ?? 'home'}…
			</p>
		{/if}
	</Card>
{/if}
