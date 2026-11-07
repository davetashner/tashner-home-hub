<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import AgendaView from '#lib/components/calendar/AgendaView.svelte';
	import EventSheet from '#lib/components/calendar/EventSheet.svelte';
	import WeekView from '#lib/components/calendar/WeekView.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import IconButton from '#lib/components/ui/IconButton.svelte';
	import { swipe } from '#lib/actions/swipe.js';
	import type { CalEvent } from '#lib/domain/calendar-view/layout.js';
	import { fetchRange, periodKeys } from '#lib/domain/calendar-view/period.js';
	import { addDays, dateKeyOf } from '#lib/domain/calendar-view/zone.js';
	import { periodTitle } from '#lib/domain/calendar-view/format.js';
	import { mealMap, type MealEntry } from '#lib/domain/meals.js';
	import { resolveTimeZone, runtimeZone } from '#lib/domain/time-zone.js';

	// The home page shows this week's calendar (hub-b4z.3). Read-only: changes happen on Calendar.
	// Swipe or the arrows page to other weeks (hub-kb9); the wall drifts back to this week when idle.
	const REFRESH_MS = 5 * 60_000;
	const IDLE_RESET_MS = 2 * 60_000;
	// Seven day columns need room for a readable title; a narrower box lists the week by day.
	const WEEK_GRID_MIN = 720;

	let tz = $state('UTC');
	let now = $state(Date.now());
	let mounted = $state(false);
	let events = $state<CalEvent[]>([]);
	let mealRows = $state<MealEntry[]>([]);
	let selected = $state<CalEvent | null>(null);
	let width = $state(0);
	/** Weeks away from this one: -1 last week, 1 next week. */
	let offset = $state(0);
	let idle: ReturnType<typeof setTimeout> | undefined;

	const today = $derived(dateKeyOf(now, tz));
	const keys = $derived(periodKeys('week', addDays(today, offset * 7)));
	const meals = $derived(mealMap(mealRows));
	const heading = $derived(
		offset === 0
			? 'This week'
			: offset === 1
				? 'Next week'
				: offset === -1
					? 'Last week'
					: periodTitle('week', keys, keys[0])
	);

	function step(dir: number) {
		offset += dir;
		clearTimeout(idle);
		if (offset !== 0) idle = setTimeout(() => (offset = 0), IDLE_RESET_MS);
	}

	// The shell swipes between sections; a swipe on the week only pages the week.
	function shield(node: HTMLElement) {
		const stop = (e: Event) => e.stopPropagation();
		node.addEventListener('pointerdown', stop);
		node.addEventListener('pointerup', stop);
		return {
			destroy() {
				node.removeEventListener('pointerdown', stop);
				node.removeEventListener('pointerup', stop);
			}
		};
	}

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

	/** Weeks already fetched, by first day, so paging back and forth is instant. */
	const cache: Record<string, { events: CalEvent[]; meals: MealEntry[] }> = {};

	async function fetchWeek(ks: string[]) {
		const r = fetchRange(ks, tz);
		const hit = cache[ks[0]];
		let ev = hit?.events ?? [];
		let ml = hit?.meals ?? [];
		try {
			const res = await fetch(`/api/calendar/events?start=${r.start}&end=${r.end}`);
			if (res.ok) ev = normalize(await res.json());
		} catch {
			// Offline: keep what we had for that week.
		}
		try {
			const res = await fetch(`/api/meals?from=${ks[0]}&to=${ks[ks.length - 1]}`);
			if (res.ok) ml = await res.json();
		} catch {
			// Offline: just no meals.
		}
		const week = { events: ev, meals: ml };
		cache[ks[0]] = week;
		return week;
	}

	async function load(ks: string[]) {
		const hit = cache[ks[0]];
		if (hit) {
			events = hit.events;
			mealRows = hit.meals;
		}
		const week = await fetchWeek(ks);
		// A swipe may have moved on while this was loading.
		if (keys[0] !== ks[0]) return;
		events = week.events;
		mealRows = week.meals;
		// Warm the neighbours so the next swipe shows at once.
		for (const dir of [1, -1]) {
			const next = periodKeys('week', addDays(ks[0], dir * 7));
			if (!(next[0] in cache)) void fetchWeek(next);
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
			clearTimeout(idle);
		};
	});

	// Load the week shown: on paging, and when the week rolls over at household midnight on Sunday.
	const weekStart = $derived(keys[0]);
	$effect(() => {
		if (mounted && weekStart) void load(keys);
	});
</script>

<section
	aria-label={heading}
	class="flex min-h-home-week flex-1 flex-col rounded-card bg-surface-raised shadow-raised max-sm:flex-none"
	data-testid="home-week"
	bind:clientWidth={width}
>
	{#if mounted}
		<div class="flex items-center justify-between gap-4 px-4 pt-3 short:pt-2">
			<h2 class="text-body font-extrabold" data-testid="home-week-title">{heading}</h2>
			<div class="flex items-center gap-2">
				{#if offset !== 0}
					<Button variant="ghost" data-testid="home-week-today" onclick={() => step(-offset)}
						>This week</Button
					>
				{/if}
				<IconButton label="Previous week" data-testid="home-week-prev" onclick={() => step(-1)}>
					<svg
						viewBox="0 0 24 24"
						aria-hidden="true"
						class="size-6 fill-none stroke-current stroke-3"><path d="M15 5l-7 7 7 7" /></svg
					>
				</IconButton>
				<IconButton label="Next week" data-testid="home-week-next" onclick={() => step(1)}>
					<svg
						viewBox="0 0 24 24"
						aria-hidden="true"
						class="size-6 fill-none stroke-current stroke-3"><path d="M9 5l7 7-7 7" /></svg
					>
				</IconButton>
			</div>
		</div>
		<div
			class="scroll min-h-0 flex-1 touch-pan-y overflow-y-auto rounded-card max-sm:overflow-visible"
			use:shield
			use:swipe={{ onswipe: (d) => (d === 'left' ? step(1) : d === 'right' ? step(-1) : null) }}
		>
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
