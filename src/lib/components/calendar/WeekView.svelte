<script lang="ts">
	import { untrack } from 'svelte';
	import {
		dayNumber,
		hourLabel,
		shortTime,
		stripeColor,
		weekdayShort
	} from '#lib/domain/calendar-view/format.js';
	import {
		spanBars,
		timedSegments,
		visibleHours,
		type CalEvent
	} from '#lib/domain/calendar-view/layout.js';
	import { minutesIntoDay, nowLineMinute } from '#lib/domain/calendar-view/now-line.js';
	import type { DateKey } from '#lib/domain/calendar-view/zone.js';
	import { daySummary } from '#lib/domain/meals.js';

	interface Props {
		events: CalEvent[];
		keys: DateKey[];
		today: DateKey;
		tz: string;
		now: number;
		/** Planned meals keyed `date|meal` (MEAL-1). */
		meals?: Map<string, string>;
		onselect: (event: CalEvent) => void;
		onday: (key: DateKey) => void;
	}
	let { events, keys, today, tz, now, meals = new Map(), onselect, onday }: Props = $props();

	const bars = $derived(spanBars(events, keys, tz));
	const barLanes = $derived(bars.reduce((n, b) => Math.max(n, b.lane + 1), 0));
	const columns = $derived(keys.map((k) => timedSegments(events, k, tz)));
	const hours = $derived(visibleHours(columns.flat(), { from: 7, to: 21 }));
	const span = $derived((hours.to - hours.from) * 60);
	const hourList = $derived(
		Array.from({ length: hours.to - hours.from }, (_, i) => hours.from + i)
	);
	/** Offset from the top of the grid, in minutes of the day. Rows are a fixed px height (see CSS). */
	const mins = (min: number) => `calc(${min - hours.from * 60} * var(--ppm))`;
	const nowMin = $derived(minutesIntoDay(now, today, tz));
	const nowLine = $derived(nowLineMinute(now, today, today, tz, hours));

	let body: HTMLElement | undefined = $state();

	// Open on what matters: an hour before now when this week holds today, otherwise
	// the earliest timed event of the week. The body may have no real size at mount and the
	// hour range can widen once events load, so re-aim whenever either changes, but only until
	// the user scrolls themselves (never fight a manual scroll).
	$effect(() => {
		const el = body;
		const scroller = el?.closest<HTMLElement>('.scroll');
		if (!el || !scroller) return;
		const from = hours.from;
		const total = span;
		let touched = false;
		const stop = () => (touched = true);
		const aim = () => {
			if (touched || el.offsetHeight === 0) return;
			const starts = untrack(() => columns.flat().map((s) => s.startMin));
			const target = untrack(() =>
				keys.includes(today)
					? Math.max(from * 60, nowMin - 60)
					: starts.length
						? Math.min(...starts) - 30
						: from * 60
			);
			scroller.scrollTop = Math.max(0, (target - from * 60) * (el.offsetHeight / total));
		};
		const events = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
		for (const e of events) scroller.addEventListener(e, stop, { passive: true });
		const observer = new ResizeObserver(aim);
		observer.observe(el);
		observer.observe(scroller);
		aim();
		return () => {
			observer.disconnect();
			for (const e of events) scroller.removeEventListener(e, stop);
		};
	});
</script>

<div class="week" style="--hours: {hours.to - hours.from}">
	<div class="sticky-top">
		<div class="head grid">
			<span></span>
			{#each keys as key (key)}
				<div class="flex flex-col items-center py-2" class:today={key === today}>
					<span class="text-body font-extrabold text-ink-muted uppercase">{weekdayShort(key)}</span>
					<span class="num text-title font-extrabold tabular-nums">{dayNumber(key)}</span>
					{#if daySummary(meals, key)}
						<span
							class="meal text-caption font-bold text-ink-muted"
							data-testid="week-meal"
							title={daySummary(meals, key)}>{daySummary(meals, key)}</span
						>
					{/if}
				</div>
			{/each}
		</div>

		{#if barLanes > 0}
			<div class="allday grid">
				<span class="gutter text-caption font-extrabold text-ink-muted">All day</span>
				{#each bars as bar (bar.event.id + bar.startCol)}
					<button
						type="button"
						class="bar press"
						class:one={bar.startCol === bar.endCol}
						class:cut-l={bar.continuesBefore}
						class:cut-r={bar.continuesAfter}
						style="grid-column: {bar.startCol + 2} / {bar.endCol + 3}; grid-row: {bar.lane +
							1}; --stripe: {stripeColor(bar.event.members)}; --m: var(--color-{bar.event.members[0]
							?.color ?? 'ink-muted'})"
						onclick={() => onselect(bar.event)}
					>
						<span class="bar-title text-body leading-tight font-extrabold">{bar.event.title}</span>
					</button>
				{/each}
			</div>
		{/if}
	</div>

	<div class="body" bind:this={body} data-testid="week-body">
		<div class="lines" aria-hidden="true">
			{#each hourList as h (h)}
				<div class="line" style="top: {mins(h * 60)}">
					<span class="gutter text-caption text-ink-muted">{hourLabel(h)}</span>
				</div>
			{/each}
		</div>
		<div class="cols grid">
			<span></span>
			{#each keys as key, i (key)}
				<div class="col" class:today={key === today}>
					<button
						type="button"
						class="day-hit"
						aria-label="Open {weekdayShort(key)} {dayNumber(key)} agenda"
						onclick={() => onday(key)}
					></button>
					{#each columns[i] as seg (seg.event.id)}
						<button
							type="button"
							class="block-ev press"
							style="top: {mins(
								seg.startMin
							)}; height: {`calc(${seg.endMin - seg.startMin} * var(--ppm))`}; left: {(seg.lane /
								seg.lanes) *
								100}%; width: {100 / seg.lanes}%; --stripe: {stripeColor(
								seg.event.members
							)}; --m: var(--color-{seg.event.members[0]?.color ?? 'ink-muted'})"
							onclick={() => onselect(seg.event)}
						>
							{#if seg.endMin - seg.startMin < 90}
								<span class="title text-caption leading-tight font-extrabold"
									><span class="text-ink-muted">{shortTime(seg.event.startsAt, tz)}</span>
									{seg.event.title}</span
								>
							{:else}
								<span class="block truncate text-caption font-extrabold text-ink-muted"
									>{shortTime(seg.event.startsAt, tz)}</span
								>
								<span
									class="title leading-tight font-extrabold {seg.lanes > 1
										? 'text-caption'
										: 'text-body'}">{seg.event.title}</span
								>
							{/if}
						</button>
					{/each}
					{#if key === today && nowLine !== null}
						<div
							class="now"
							data-testid="now-line"
							style="top: {mins(nowLine)}"
							aria-hidden="true"
						></div>
					{/if}
				</div>
			{/each}
		</div>
	</div>
</div>

<style>
	.week {
		/* 120px an hour: a 30-minute event is exactly the 60px tap minimum. */
		--ppm: 2px;
		display: flex;
		min-height: 100%;
		flex-direction: column;
	}
	.sticky-top {
		position: sticky;
		top: 0;
		z-index: 2;
		background: var(--color-surface);
	}
	.grid {
		display: grid;
		grid-template-columns: 6rem repeat(7, minmax(0, 1fr));
	}
	.gutter {
		padding-right: 0.75rem;
		text-align: right;
	}
	.head .today .num {
		display: grid;
		min-width: 4.5rem;
		place-items: center;
		border-radius: var(--radius-chip);
		background: var(--color-accent);
		color: var(--color-on-accent);
	}
	.meal {
		max-width: 100%;
		overflow: hidden;
		padding: 0 0.25rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.allday {
		gap: 0.375rem 0.25rem;
		padding-bottom: 0.75rem;
		border-bottom: 2px solid var(--color-line);
	}
	.allday .gutter {
		align-self: center;
		grid-row: 1;
		grid-column: 1;
	}
	.bar {
		display: flex;
		min-height: var(--spacing-tap);
		align-items: center;
		position: relative;
		overflow: hidden;
		padding: 0 1rem 0 1.5rem;
		border-radius: var(--radius-control);
		background: color-mix(in oklab, var(--m) 30%, var(--color-surface-raised));
		color: var(--color-ink);
		text-align: left;
	}
	.bar::before {
		position: absolute;
		inset: 0 auto 0 0;
		width: 0.5rem;
		background: var(--stripe);
		content: '';
	}
	.bar-title {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		overflow: hidden;
		overflow-wrap: break-word;
	}
	.bar.one {
		padding: 0 0.375rem 0 1.125rem;
	}
	.bar.one .bar-title {
		font-size: var(--text-caption);
	}
	.bar.cut-l {
		border-top-left-radius: 0;
		border-bottom-left-radius: 0;
	}
	.bar.cut-r {
		border-top-right-radius: 0;
		border-bottom-right-radius: 0;
	}
	.body {
		position: relative;
		height: calc(var(--hours) * 60 * var(--ppm));
		flex: none;
		margin-top: 0.75rem;
	}
	.lines,
	.cols {
		position: absolute;
		inset: 0;
	}
	.line {
		position: absolute;
		right: 0;
		left: 0;
		border-top: 2px solid var(--color-line);
	}
	.line .gutter {
		display: block;
		width: 6rem;
		margin-top: -0.9em;
		background: var(--color-surface);
		line-height: 1.2;
	}
	.col {
		container-type: inline-size;
		position: relative;
		border-left: 2px solid var(--color-line);
	}
	.col.today {
		background: color-mix(in oklch, var(--color-accent) 7%, transparent);
	}
	.day-hit {
		position: absolute;
		inset: 0;
		border: 0;
		background: transparent;
	}
	.block-ev {
		position: absolute;
		display: flex;
		min-height: var(--spacing-tap);
		flex-direction: column;
		justify-content: center;
		overflow: hidden;
		padding: 0.25rem 0.375rem 0.25rem 1rem;
		border: 0;
		border-radius: var(--radius-control);
		background:
			var(--stripe) left / 0.375rem 100% no-repeat,
			color-mix(in oklab, var(--m) 30%, var(--color-surface-raised));
		color: var(--color-ink);
		text-align: left;
		outline: 2px solid var(--color-surface);
	}
	@container (max-width: 15rem) {
		.block-ev .title {
			font-size: var(--text-caption);
		}
	}
	.block-ev .title {
		overflow-wrap: break-word;
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		overflow: hidden;
	}
	.now {
		position: absolute;
		right: 0;
		left: 0;
		height: 0.25rem;
		margin-top: -0.125rem;
		background: var(--color-danger);
		pointer-events: none;
	}
	.now::before {
		position: absolute;
		top: 50%;
		left: -0.5rem;
		width: 1.25rem;
		height: 1.25rem;
		margin-top: -0.625rem;
		border-radius: var(--radius-chip);
		background: var(--color-danger);
		content: '';
	}
	.press {
		cursor: pointer;
		transition: transform var(--duration-quick) var(--ease-out-soft);
	}
	.press:active {
		transform: scale(0.97);
		transition-duration: var(--duration-instant);
	}
	.press:focus-visible {
		outline: 4px solid var(--color-accent);
		outline-offset: 2px;
	}
</style>
