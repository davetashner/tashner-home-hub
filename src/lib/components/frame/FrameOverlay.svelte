<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import WeatherIcon from '#lib/components/weather/WeatherIcon.svelte';
	import { formatClock } from '#lib/domain/clock.js';
	import type { CalEvent } from '#lib/domain/calendar-view/layout.js';
	import {
		DEFAULT_OVERLAY,
		EVENTS_REFRESH_MS,
		WEATHER_REFRESH_MS,
		eventsWindow,
		formatNextEvent,
		formatOverlayWeather,
		msToNextMinute,
		overlayNudge,
		overlayVisibility,
		parseOverlaySettings,
		pickNextEvent,
		type OverlaySettings
	} from '#lib/domain/frame-overlay.js';
	import { frameOverlay } from '#lib/components/shell/frame-overlay-state.svelte.js';
	import { defaultTimeZone, isTimeZone } from '#lib/domain/time-zone.js';
	import type { WeatherCurrent, WeatherDay } from '#lib/domain/weather.js';

	/** Clock, date, weather and next event over the photo frame (PHO-7). Never takes a touch. */
	let settings = $state<OverlaySettings>({ ...DEFAULT_OVERLAY });
	let now = $state(Date.now());
	let events = $state<CalEvent[]>([]);
	let weather = $state<{ current: WeatherCurrent; days: WeatherDay[] } | null>(null);

	const zone = $derived(isTimeZone(page.data.timeZone) ? page.data.timeZone : defaultTimeZone());
	const clock = $derived(formatClock(new Date(now), { timeZone: zone }));
	const show = $derived(overlayVisibility(settings, weather !== null));
	const next = $derived(show.nextEvent ? pickNextEvent(events, now, zone) : null);
	const wx = $derived(
		weather ? formatOverlayWeather(weather.current, weather.days, now, zone) : null
	);
	const nudge = $derived(overlayNudge(now));

	// Tell the shell what is on screen; cleared when the overlay goes away.
	$effect(() => {
		frameOverlay.any = show.any;
		frameOverlay.clock = show.any && show.clock;
		return () => {
			frameOverlay.any = false;
			frameOverlay.clock = false;
		};
	});

	async function getJson(url: string): Promise<unknown> {
		const res = await fetch(url).catch(() => null);
		return res?.ok ? res.json().catch(() => null) : null;
	}

	async function loadWeather() {
		const body = (await getJson('/api/weather')) as {
			enabled?: boolean;
			snapshot?: { current?: WeatherCurrent; days?: WeatherDay[] };
		} | null;
		// A failed refresh keeps what is showing; only an explicit "off" clears it.
		if (!body) return;
		const snap = body.snapshot;
		weather =
			body.enabled && snap?.current
				? { current: snap.current, days: Array.isArray(snap.days) ? snap.days : [] }
				: null;
	}

	async function loadEvents() {
		const { start, end } = eventsWindow(Date.now(), zone);
		const body = await getJson(`/api/calendar/events?start=${start}&end=${end}`);
		if (Array.isArray(body)) events = body as CalEvent[];
	}

	onMount(() => {
		let tick: number | undefined;
		const schedule = () => {
			tick = window.setTimeout(() => {
				now = Date.now();
				schedule();
			}, msToNextMinute(Date.now()));
		};
		schedule();
		void getJson('/api/settings/frame-overlay').then((s) => {
			if (s) settings = parseOverlaySettings(s);
		});
		void loadWeather();
		void loadEvents();
		const weatherTimer = window.setInterval(() => void loadWeather(), WEATHER_REFRESH_MS);
		const eventsTimer = window.setInterval(() => void loadEvents(), EVENTS_REFRESH_MS);
		return () => {
			window.clearTimeout(tick);
			window.clearInterval(weatherTimer);
			window.clearInterval(eventsTimer);
		};
	});
</script>

{#if show.any}
	<div
		class="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-linear-to-t from-scrim to-transparent pt-24"
		data-testid="frame-overlay"
		aria-hidden="true"
	>
		<div
			class="nudge flex items-end justify-between gap-8 p-8 text-on-frame"
			style:--nx={nudge.x}
			style:--ny={nudge.y}
		>
			<div class="flex min-w-0 flex-col gap-2">
				{#if show.clock}
					<p
						class="overlay-text text-display leading-none font-extrabold whitespace-nowrap tabular-nums"
						data-testid="overlay-time"
					>
						{clock.time}
					</p>
				{/if}
				{#if show.date}
					<p class="overlay-text text-title" data-testid="overlay-date">{clock.date}</p>
				{/if}
				{#if next}
					<p class="overlay-text text-lead font-bold" data-testid="overlay-next">
						{formatNextEvent(next)}
					</p>
				{/if}
			</div>
			{#if show.weather && wx}
				<div
					class="overlay-text flex flex-col items-end gap-2 font-bold whitespace-nowrap"
					data-testid="overlay-weather"
				>
					<p class="flex items-center gap-3 text-lead" data-testid="overlay-weather-now">
						<span class="text-title leading-none"><WeatherIcon name={wx.current.icon} /></span>
						<span class="text-title leading-none font-extrabold">{wx.current.temp}</span>
						<span>Current</span>
					</p>
					{#if wx.day}
						<p class="flex items-center gap-3 text-lead" data-testid="overlay-weather-day">
							<span class="leading-none"><WeatherIcon name={wx.day.icon} /></span>
							<span>{wx.day.label}</span>
							<span class="font-extrabold">{wx.day.high}</span>
							<span class="font-semibold opacity-80">/ {wx.day.low}</span>
						</p>
					{/if}
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	/* Burn-in drift: only transform moves, a small step every few minutes. */
	.nudge {
		transform: translate(
			calc(var(--nx) * var(--spacing-overlay-nudge)),
			calc(var(--ny) * var(--spacing-overlay-nudge))
		);
	}
	.overlay-text {
		text-shadow: var(--shadow-frame-text);
	}
</style>
