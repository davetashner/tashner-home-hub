<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import AgendaView from '#lib/components/calendar/AgendaView.svelte';
	import EventSheet from '#lib/components/calendar/EventSheet.svelte';
	import WeekView from '#lib/components/calendar/WeekView.svelte';
	import type { CalEvent } from '#lib/domain/calendar-view/layout.js';
	import { fetchRange, periodKeys } from '#lib/domain/calendar-view/period.js';
	import { dateKeyOf } from '#lib/domain/calendar-view/zone.js';
	import { mealMap, type MealEntry } from '#lib/domain/meals.js';
	import { resolveTimeZone, runtimeZone } from '#lib/domain/time-zone.js';

	// The home page shows this week's calendar (hub-b4z.3). Read-only: changes happen on Calendar.
	const REFRESH_MS = 5 * 60_000;
	// Seven day columns need room for a readable title; a narrower box lists the week by day.
	const WEEK_GRID_MIN = 720;

	let tz = $state('UTC');
	let now = $state(Date.now());
	let mounted = $state(false);
	let events = $state<CalEvent[]>([]);
	let mealRows = $state<MealEntry[]>([]);
	let selected = $state<CalEvent | null>(null);
	let width = $state(0);

	const today = $derived(dateKeyOf(now, tz));
	const keys = $derived(periodKeys('week', today));
	const meals = $derived(mealMap(mealRows));

	/** Rows from the API, made safe to render: anything malformed is dropped, gaps filled. */
	function normalize(rows: unknown): CalEvent[] {
		if (!Array.isArray(rows)) return [];
		return rows.flatMap((r: Partial<CalEvent>, i) =>
			r && typeof r.title === 'string' && Number.isFinite(r.startsAt) && Number.isFinite(r.endsAt)
				? [
						{
							...r,
							id: typeof r.id === 'string' ? r.id : `home-week-${i}`,
							title: r.title,
							startsAt: r.startsAt!,
							endsAt: r.endsAt!,
							allDay: r.allDay === true,
							location: r.location ?? null,
							notes: r.notes ?? null,
							members: Array.isArray(r.members) ? r.members : []
						}
					]
				: []
		);
	}

	async function load(ks: string[]) {
		const r = fetchRange(ks, tz);
		try {
			const res = await fetch(`/api/calendar/events?start=${r.start}&end=${r.end}`);
			if (res.ok) events = normalize(await res.json());
		} catch {
			// Offline: keep the last week shown.
		}
		try {
			const res = await fetch(`/api/meals?from=${ks[0]}&to=${ks[ks.length - 1]}`);
			if (res.ok) mealRows = await res.json();
		} catch {
			// Offline: just no meals.
		}
	}

	onMount(() => {
		tz = resolveTimeZone(page.data.timeZone, runtimeZone());
		now = Date.now();
		mounted = true;
		const tick = setInterval(() => (now = Date.now()), 60_000);
		const refresh = setInterval(() => void load(keys), REFRESH_MS);
		return () => {
			clearInterval(tick);
			clearInterval(refresh);
		};
	});

	// Load the week, and again when the week rolls over at household midnight on Sunday.
	const weekStart = $derived(keys[0]);
	$effect(() => {
		if (mounted && weekStart) void load(keys);
	});
</script>

<section
	aria-label="This week"
	class="flex min-h-home-week flex-1 flex-col rounded-card bg-surface-raised shadow-raised max-sm:flex-none"
	data-testid="home-week"
	bind:clientWidth={width}
>
	{#if mounted}
		<div class="scroll min-h-0 flex-1 overflow-y-auto rounded-card max-sm:overflow-visible">
			{#if width < WEEK_GRID_MIN}
				<AgendaView {events} {keys} {today} {tz} {now} all onselect={(e) => (selected = e)} />
			{:else}
				<WeekView
					{events}
					{keys}
					{today}
					{tz}
					{now}
					{meals}
					onselect={(e) => (selected = e)}
					onday={() => void goto(resolve('/(app)/calendar'))}
				/>
			{/if}
		</div>
	{/if}
</section>

{#if selected}
	<EventSheet event={selected} {tz} onclose={() => (selected = null)} />
{/if}
