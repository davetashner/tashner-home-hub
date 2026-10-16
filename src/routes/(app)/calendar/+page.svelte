<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { swipe } from '#lib/actions/swipe.js';
	import AgendaView from '#lib/components/calendar/AgendaView.svelte';
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
	import { dateKeyOf, type DateKey } from '#lib/domain/calendar-view/zone.js';
	import { resolveTimeZone, runtimeZone } from '#lib/domain/time-zone.js';
	import { page } from '$app/state';

	interface Status {
		sources: { sourceId: string; lastSyncAt: number | null; stale: boolean }[];
		stale: boolean;
	}

	const VIEW_KEY = 'hub.calendar.view';
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
	let portrait = $state(false);

	const today = $derived(dateKeyOf(now, tz));
	const keys = $derived(periodKeys(view, anchor));
	const title = $derived(periodTitle(view, keys, anchor));
	const events = $derived(cache[cacheKey(keys)] ?? []);
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
		const media = matchMedia('(orientation: portrait)');
		const onOrientation = () => (portrait = media.matches);
		onOrientation();
		media.addEventListener('change', onOrientation);
		mounted = true;
		void loadStatus();
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
	<section class="flex h-full flex-col items-center justify-center gap-8 p-8 text-center">
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
	<div class="flex h-full flex-col gap-4 px-12 pb-6 portrait:px-10">
		<div class="flex flex-wrap items-center justify-between gap-x-8 gap-y-3">
			<div class="flex min-w-0 items-center gap-6">
				<h1 class="sr-only">Calendar</h1>
				<p class="text-lead leading-none font-extrabold" data-testid="period-title">
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
			<div class="flex flex-wrap items-center gap-4">
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
		</div>

		<div
			class="viewport min-h-0 flex-1"
			use:shield
			use:swipe={{ onswipe: (d) => (d === 'left' ? step(1) : d === 'right' ? step(-1) : null) }}
		>
			{#if mounted}
				{#key `${view}:${anchor}`}
					<div class="pane scroll {direction}" data-testid="calendar-pane">
						{#if view === 'agenda'}
							<AgendaView {events} {keys} {today} {tz} onselect={(e) => (selected = e)} />
						{:else if view === 'week'}
							<WeekView
								{events}
								{keys}
								{today}
								{tz}
								{now}
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

{#if selected}
	<EventSheet event={selected} {tz} onclose={() => (selected = null)} />
{/if}

<style>
	.viewport {
		position: relative;
		overflow: hidden;
		touch-action: pan-y;
	}
	.pane {
		height: 100%;
	}
	.pane.scroll {
		overflow-y: auto;
		padding-bottom: 1rem;
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
	.today-btn {
		padding: 0 2rem;
	}
	.seg-btn:focus-visible,
	.nav-btn:focus-visible {
		outline: 4px solid var(--color-accent);
		outline-offset: 4px;
	}
</style>
