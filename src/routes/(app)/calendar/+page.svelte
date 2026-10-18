<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { swipe } from '#lib/actions/swipe.js';
	import AgendaView from '#lib/components/calendar/AgendaView.svelte';
	import AddEventSheet, {
		type WritableCalendar
	} from '#lib/components/calendar/AddEventSheet.svelte';
	import EventSheet from '#lib/components/calendar/EventSheet.svelte';
	import MonthView from '#lib/components/calendar/MonthView.svelte';
	import WeekView from '#lib/components/calendar/WeekView.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import { ago, periodTitle } from '#lib/domain/calendar-view/format.js';
	import type { CalEvent } from '#lib/domain/calendar-view/layout.js';
	import {
		fetchRange,
		isViewMode,
		periodKeys,
		shiftAnchor,
		VIEW_MODES,
		type CalendarViewMode
	} from '#lib/domain/calendar-view/period.js';
	import MemberAvatar from '#lib/components/MemberAvatar.svelte';
	import {
		filterEvents,
		parseSelection,
		pruneSelection,
		serializeSelection,
		toggleMember
	} from '#lib/domain/calendar-view/member-filter.js';
	import { isMemberColor, type MemberColor } from '#lib/domain/member-colors.js';
	import {
		newDraft,
		overlaps,
		pendingEvent,
		toRequest,
		type EventDraft
	} from '#lib/domain/calendar-view/new-event.js';
	import { dateKeyOf, dayStartMs, type DateKey } from '#lib/domain/calendar-view/zone.js';
	import { resolveTimeZone, runtimeZone } from '#lib/domain/time-zone.js';
	import { page } from '$app/state';
	import { mealMap, type MealEntry } from '#lib/domain/meals.js';

	interface Status {
		sources: { sourceId: string; lastSyncAt: number | null; stale: boolean }[];
		stale: boolean;
	}

	interface FilterMember {
		id: string;
		name: string;
		color: MemberColor;
		avatar: string | null;
	}

	const VIEW_KEY = 'hub.calendar.view';
	const MEMBERS_KEY = 'hub.calendar.members';
	const NEW_CAL_KEY = 'hub.calendar.newEventCalendar';
	const LABELS: Record<CalendarViewMode, string> = {
		agenda: 'Agenda',
		week: 'Week',
		month: 'Month'
	};

	let mounted = $state(false);
	let tz = $state('UTC');
	let now = $state(Date.now());
	let view = $state<CalendarViewMode>('agenda');
	let anchor = $state<DateKey>('1970-01-01');
	let direction = $state<'next' | 'prev' | 'none'>('none');
	let cache = $state<Record<string, CalEvent[]>>({});
	let status = $state<Status | null>(null);
	let selected = $state<CalEvent | null>(null);
	let familyMembers = $state<FilterMember[]>([]);
	let chosen = $state<string[]>([]);
	let portrait = $state(false);
	let paneWidth = $state(0);
	// Seven day columns need room for a readable title; a narrower pane lists the week by day.
	const WEEK_GRID_MIN = 720;

	const today = $derived(dateKeyOf(now, tz));
	const keys = $derived(periodKeys(view, anchor));
	const title = $derived(periodTitle(view, keys, anchor));
	const adult = $derived(page.data.adult === true);
	const wall = $derived(page.data.displayRole === 'wall');
	let writable = $state<WritableCalendar[]>([]);
	let draft = $state<EventDraft | null>(null);
	let pending = $state<CalEvent[]>([]);
	let notice = $state('');
	let seq = 0;
	const events = $derived.by(() => {
		const r = fetchRange(keys, tz);
		const mine = pending.filter((p) => overlaps(p, r.start, r.end));
		return [...filterEvents(cache[cacheKey(keys)] ?? [], chosen), ...mine].sort(
			(a, b) => a.startsAt - b.startsAt
		);
	});
	const staleSince = $derived.by(() => {
		const stale = status?.sources.filter((s) => s.stale) ?? [];
		if (!stale.length) return null;
		const times = stale.map((s) => s.lastSyncAt);
		return times.includes(null) ? null : Math.min(...(times as number[]));
	});

	function cacheKey(ks: DateKey[]): string {
		const r = fetchRange(ks, tz);
		return `${r.start}:${r.end}`;
	}

	async function load(ks: DateKey[], force = false) {
		const k = cacheKey(ks);
		if (cache[k] && !force) return;
		const r = fetchRange(ks, tz);
		try {
			const res = await fetch(`/api/calendar/events?start=${r.start}&end=${r.end}`);
			if (res.ok) cache[k] = await res.json();
		} catch {
			// Offline: keep showing whatever is cached.
		}
	}

	// MEAL-1: the week view shows each day's planned meal under its date. Best effort.
	let mealCache = $state<Record<string, MealEntry[]>>({});
	const meals = $derived(mealMap(mealCache[keys[0]] ?? []));
	async function loadMeals(ks: DateKey[]) {
		try {
			const res = await fetch(`/api/meals?from=${ks[0]}&to=${ks[ks.length - 1]}`);
			if (res.ok) mealCache[ks[0]] = await res.json();
		} catch {
			// Offline: the week view just shows no meals.
		}
	}
	$effect(() => {
		if (mounted && view === 'week') void loadMeals(keys);
	});

	// CAL-9: adults can add events to the iCloud calendars the household connected.
	async function loadWritable() {
		try {
			const res = await fetch('/api/calendar/sources');
			if (!res.ok) return;
			const sources: {
				provider: string;
				label: string;
				calendars: { externalId: string; name: string; selected: boolean }[];
			}[] = await res.json();
			writable = sources
				.filter((src) => src.provider === 'icloud')
				.flatMap((src) =>
					src.calendars
						.filter((c) => c.selected)
						.map((c) => ({ id: c.externalId, name: c.name || 'Calendar', account: src.label }))
				);
		} catch {
			// Offline: no Add event button until the next load.
		}
	}

	function openAdd() {
		let last: string | null = null;
		try {
			last = localStorage.getItem(NEW_CAL_KEY);
		} catch {
			// Storage unavailable: start on the first calendar.
		}
		const calendarId = writable.find((c) => c.id === last)?.id ?? writable[0]?.id ?? '';
		const nowMin = Math.floor((now - dayStartMs(today, tz)) / 60_000);
		draft = newDraft(today, nowMin, calendarId);
	}

	async function addEvent(d: EventDraft) {
		const ghost = pendingEvent(d, tz, `pending-${++seq}`);
		pending = [...pending, ghost];
		draft = null;
		notice = '';
		try {
			localStorage.setItem(NEW_CAL_KEY, d.calendarId);
		} catch {
			// Storage unavailable: the choice just does not stick.
		}
		try {
			const res = await fetch('/api/calendar/events', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(toRequest(d))
			});
			if (!res.ok) {
				const body = await res.json().catch(() => null);
				notice = `Could not add "${ghost.title}": ${
					typeof body?.message === 'string' ? body.message : 'the calendar said no.'
				}`;
			} else {
				cache = {};
				await load(keys, true);
			}
		} catch {
			notice = `Could not add "${ghost.title}": the hub could not be reached, so nothing was saved.`;
		} finally {
			pending = pending.filter((p) => p.id !== ghost.id);
		}
	}

	async function loadStatus() {
		try {
			const res = await fetch('/api/calendar/status');
			if (res.ok) status = await res.json();
		} catch {
			// Keep the last known status.
		}
	}

	function go(next: DateKey, dir: 'next' | 'prev' | 'none') {
		direction = dir;
		anchor = next;
	}
	const step = (dir: 1 | -1) => go(shiftAnchor(view, anchor, dir), dir === 1 ? 'next' : 'prev');
	const toToday = () => go(today, 'none');

	function setView(next: CalendarViewMode) {
		direction = 'none';
		view = next;
		try {
			localStorage.setItem(VIEW_KEY, next);
		} catch {
			// Private mode or blocked storage: the preference just does not stick.
		}
	}

	function chooseMembers(next: string[]) {
		chosen = next;
		try {
			localStorage.setItem(MEMBERS_KEY, serializeSelection(next));
		} catch {
			// Storage unavailable: the choice just does not stick.
		}
	}

	async function loadMembers() {
		try {
			const res = await fetch('/api/members');
			if (!res.ok) return;
			const list: FilterMember[] = (await res.json()).filter((m: FilterMember) =>
				isMemberColor(m.color)
			);
			familyMembers = list;
			const kept = pruneSelection(
				chosen,
				list.map((m) => m.id)
			);
			if (kept.length !== chosen.length) chooseMembers(kept);
		} catch {
			// Offline: no chips until the next refresh.
		}
	}

	function openDay(key: DateKey) {
		view = 'agenda';
		go(key, 'none');
	}

	// Load the visible period, then quietly warm the neighbours so swiping is instant.
	$effect(() => {
		if (!mounted) return;
		void load(keys).then(() => {
			void load(periodKeys(view, shiftAnchor(view, anchor, 1)));
			void load(periodKeys(view, shiftAnchor(view, anchor, -1)));
		});
	});

	// Keep the shield from the shell's section-swipe so a calendar swipe only changes the period.
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

	onMount(() => {
		tz = resolveTimeZone(page.data.timeZone, runtimeZone());
		now = Date.now();
		anchor = dateKeyOf(now, tz);
		try {
			const saved = localStorage.getItem(VIEW_KEY);
			if (isViewMode(saved)) view = saved;
		} catch {
			// Storage unavailable: use the default view.
		}
		try {
			chosen = parseSelection(localStorage.getItem(MEMBERS_KEY));
		} catch {
			// Storage unavailable: show everyone.
		}
		const media = matchMedia('(orientation: portrait)');
		const onOrientation = () => (portrait = media.matches);
		onOrientation();
		media.addEventListener('change', onOrientation);
		mounted = true;
		void loadStatus();
		void loadMembers();
		if (page.data.adult === true) void loadWritable();
		const timer = setInterval(() => {
			now = Date.now();
			void loadStatus();
			void load(keys, true);
		}, 60_000);
		return () => {
			clearInterval(timer);
			media.removeEventListener('change', onOrientation);
		};
	});
</script>

<svelte:head>
	<title>Calendar · Home Hub</title>
</svelte:head>

{#if status && status.sources.length === 0}
	<section
		class="flex h-full flex-col items-center justify-center gap-8 p-8 text-center short:gap-3 short:p-3"
	>
		<h1 class="text-headline leading-none font-extrabold">Calendar</h1>
		<p class="max-w-2xl text-lead text-balance text-ink-muted">
			No calendars are connected yet. An adult can add one in Settings.
		</p>
		<a
			href={resolve('/(app)/settings')}
			class="inline-flex min-h-tap items-center rounded-control bg-accent px-8 text-body font-extrabold text-on-accent shadow-raised"
			>Open Settings</a
		>
	</section>
{:else}
	<div
		class="page flex h-full flex-col gap-4 px-12 pb-6 portrait:px-10 short:gap-2 short:pt-2 short:pb-2"
	>
		<div
			class="flex flex-wrap items-center justify-between gap-x-8 gap-y-3 short:flex-nowrap short:gap-x-3 short:max-md:flex-wrap"
		>
			<div class="flex min-w-0 items-center gap-6">
				<h1 class="sr-only">Calendar</h1>
				<p class="text-lead leading-none font-extrabold short:text-body" data-testid="period-title">
					{#if mounted}{title}{/if}
				</p>
				{#if staleSince !== null || (status?.stale ?? false)}
					<Badge tone="star">
						<span data-testid="stale-badge">
							{staleSince === null ? 'Not synced yet' : `Last updated ${ago(staleSince, now)}`}
						</span>
					</Badge>
				{/if}
			</div>
			<div class="flex flex-wrap items-center gap-4 short:flex-nowrap short:gap-2">
				<div role="group" aria-label="View" class="seg">
					{#each VIEW_MODES as mode (mode)}
						<button
							type="button"
							class="seg-btn"
							aria-pressed={view === mode}
							onclick={() => setView(mode)}>{LABELS[mode]}</button
						>
					{/each}
				</div>
				{#if adult && writable.length > 0}
					<button type="button" class="nav-btn add-btn" data-testid="add-event" onclick={openAdd}
						>Add event</button
					>
				{/if}
				<div class="flex items-center gap-2">
					<button type="button" class="nav-btn" aria-label="Previous" onclick={() => step(-1)}>
						<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
					</button>
					<button type="button" class="nav-btn today-btn" onclick={toToday}>Today</button>
					<button type="button" class="nav-btn" aria-label="Next" onclick={() => step(1)}>
						<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
					</button>
				</div>
			</div>
			{#if familyMembers.length > 1}
				<div role="group" aria-label="Show events for" class="chips" data-testid="member-filter">
					<button
						type="button"
						class="chip"
						aria-pressed={chosen.length === 0}
						onclick={() => chooseMembers([])}>Everyone</button
					>
					{#each familyMembers as m (m.id)}
						<button
							type="button"
							class="chip"
							aria-pressed={chosen.includes(m.id)}
							onclick={() => chooseMembers(toggleMember(chosen, m.id))}
						>
							<span class="chip-avatar" aria-hidden="true">
								<MemberAvatar name={m.name} color={m.color} avatar={m.avatar} size="sm" />
							</span>
							<span>{m.name}</span>
						</button>
					{/each}
				</div>
			{/if}
		</div>

		{#if notice}
			<div
				role="alert"
				class="flex items-center justify-between gap-4 rounded-card border-2 border-danger bg-surface-raised px-6 py-3 text-body font-extrabold"
				data-testid="add-event-error"
			>
				<span class="min-w-0">{notice}</span>
				<button type="button" class="nav-btn shrink-0 px-4" onclick={() => (notice = '')}
					>Dismiss</button
				>
			</div>
		{/if}

		<div
			class="viewport min-h-0 flex-1"
			bind:clientWidth={paneWidth}
			use:shield
			use:swipe={{ onswipe: (d) => (d === 'left' ? step(1) : d === 'right' ? step(-1) : null) }}
		>
			{#if mounted}
				{#key `${view}:${anchor}`}
					<div class="pane scroll {direction}" data-testid="calendar-pane">
						{#if view === 'agenda'}
							<AgendaView {events} {keys} {today} {tz} {now} onselect={(e) => (selected = e)} />
						{:else if view === 'week' && paneWidth < WEEK_GRID_MIN}
							<AgendaView {events} {keys} {today} {tz} {now} all onselect={(e) => (selected = e)} />
						{:else if view === 'week'}
							<WeekView
								{events}
								{keys}
								{today}
								{tz}
								{now}
								{meals}
								onselect={(e) => (selected = e)}
								onday={openDay}
							/>
						{:else}
							<MonthView
								{events}
								{keys}
								{anchor}
								{today}
								{tz}
								lines={portrait ? 8 : 3}
								onday={openDay}
							/>
						{/if}
					</div>
				{/key}
			{/if}
		</div>
	</div>
{/if}

{#if draft}
	<AddEventSheet
		bind:draft
		calendars={writable}
		{today}
		{wall}
		onsubmit={addEvent}
		onclose={() => (draft = null)}
	/>
{/if}

{#if selected}
	<EventSheet event={selected} {tz} onclose={() => (selected = null)} />
{/if}

<style>
	.viewport {
		position: relative;
		/* Clip only sideways (the slide animation); the pane inside is what scrolls vertically. */
		overflow-x: clip;
		touch-action: pan-y;
	}
	.pane {
		height: 100%;
	}
	.pane.scroll {
		overflow-y: auto;
		padding-bottom: 1rem;
	}
	/* Phones: the controls take most of a small screen, so the whole page scrolls (the shell's
	   main is the scroller) instead of squeezing events into a short inner pane. */
	@media (max-width: 40rem) {
		.page {
			height: auto;
			min-height: 100%;
		}
		.viewport {
			flex: none;
		}
		.pane,
		.pane.scroll {
			height: auto;
			overflow-y: visible;
		}
	}
	.pane.next {
		animation: slide-next var(--duration-base) var(--ease-out-soft) both;
	}
	.pane.prev {
		animation: slide-prev var(--duration-base) var(--ease-out-soft) both;
	}
	.pane.none {
		animation: fade var(--duration-base) linear both;
	}
	@keyframes slide-next {
		from {
			opacity: 0;
			transform: translateX(4rem);
		}
	}
	@keyframes slide-prev {
		from {
			opacity: 0;
			transform: translateX(-4rem);
		}
	}
	@keyframes fade {
		from {
			opacity: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.pane {
			animation: none !important;
		}
	}
	.seg {
		display: inline-flex;
		gap: 0.25rem;
		padding: 0.25rem;
		border-radius: var(--radius-chip);
		background: var(--color-surface-sunken);
	}
	.seg-btn {
		min-width: 5rem;
		min-height: var(--spacing-tap);
		padding: 0 1.75rem;
		border-radius: var(--radius-chip);
		color: var(--color-ink-muted);
		font-weight: 800;
		cursor: pointer;
	}
	.seg-btn[aria-pressed='true'] {
		background: var(--color-accent);
		color: var(--color-on-accent);
		box-shadow: var(--shadow-raised);
	}
	.nav-btn {
		display: inline-flex;
		min-width: var(--spacing-tap);
		min-height: var(--spacing-tap);
		align-items: center;
		justify-content: center;
		border: 2px solid var(--color-line);
		border-radius: var(--radius-chip);
		background: var(--color-surface-raised);
		box-shadow: var(--shadow-raised);
		font-weight: 800;
		cursor: pointer;
		transition: transform var(--duration-quick) var(--ease-out-soft);
	}
	.nav-btn:active {
		transform: scale(0.94);
		transition-duration: var(--duration-instant);
	}
	.nav-btn svg {
		width: 1.75rem;
		height: 1.75rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 2.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	/* Chips wrap onto more rows rather than running off narrow screens. */
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		min-width: 0;
		max-width: 100%;
		/* Two rows at most; a very long member list scrolls inside instead of eating the calendar. */
		max-height: calc(var(--spacing-tap) * 2 + 0.5rem);
		overflow-y: auto;
	}
	/* Phones: the page scrolls, so the chips need no two-row cap (it clipped the second row).
	   Kept after .chips so it wins on source order. */
	@media (max-width: 40rem) {
		.chips {
			max-height: none;
			overflow-y: visible;
		}
	}
	.chip {
		display: inline-flex;
		min-width: 0;
		max-width: 100%;
		min-height: var(--spacing-tap);
		align-items: center;
		gap: 0.5rem;
		padding: 0 1rem 0 0.375rem;
		border: 2px solid var(--color-line);
		border-radius: var(--radius-chip);
		background: var(--color-surface-raised);
		font-weight: 800;
		cursor: pointer;
	}
	/* The avatar fills the chip's height, so it sits in the pill's rounded end with no left inset. */
	.chip:has(.chip-avatar) {
		padding-left: 0;
	}
	.chip-avatar {
		display: flex;
		flex-shrink: 0;
	}
	.chip > span:last-child {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.chip:first-child {
		padding-inline: 1.25rem;
	}
	.chip[aria-pressed='true'] {
		border-color: var(--color-accent);
		background: var(--color-accent);
		color: var(--color-on-accent);
	}
	.chip:focus-visible {
		outline: 4px solid var(--color-accent);
		outline-offset: 4px;
	}
	.today-btn,
	.add-btn {
		padding: 0 2rem;
	}
	/* Phone width, or a phone turned sideways: the switcher and period controls have to fit on one row. */
	@media (max-width: 40rem), (orientation: landscape) and (max-height: 32rem) {
		.page {
			padding-inline: 1rem;
		}
		.seg-btn {
			min-width: 0;
			padding: 0 0.625rem;
		}
		.today-btn,
		.add-btn {
			padding: 0 1rem;
		}
	}
	.seg-btn:focus-visible,
	.nav-btn:focus-visible {
		outline: 4px solid var(--color-accent);
		outline-offset: 4px;
	}
</style>
