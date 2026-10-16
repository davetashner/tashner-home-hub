<script lang="ts">
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
	import { zonedMs, type DateKey } from '#lib/domain/calendar-view/zone.js';

	interface Props {
		events: CalEvent[];
		keys: DateKey[];
		today: DateKey;
		tz: string;
		now: number;
		onselect: (event: CalEvent) => void;
	}
	let { events, keys, today, tz, now, onselect }: Props = $props();

	const bars = $derived(spanBars(events, keys, tz));
	const barLanes = $derived(bars.reduce((n, b) => Math.max(n, b.lane + 1), 0));
	const columns = $derived(keys.map((k) => timedSegments(events, k, tz)));
	const hours = $derived(visibleHours(columns.flat(), { from: 8, to: 20 }));
	const span = $derived((hours.to - hours.from) * 60);
	const hourList = $derived(
		Array.from({ length: hours.to - hours.from }, (_, i) => hours.from + i)
	);
	const pct = (min: number) => `${((min - hours.from * 60) / span) * 100}%`;
	const nowMin = $derived((now - zonedMs(today, 0, tz)) / 60_000);
</script>

<div class="week" style="--hours: {hours.to - hours.from}">
	<div class="sticky-top">
		<div class="head grid">
			<span></span>
			{#each keys as key (key)}
				<div class="flex flex-col items-center py-2" class:today={key === today}>
					<span class="text-body font-extrabold text-ink-muted uppercase">{weekdayShort(key)}</span>
					<span class="num text-title font-extrabold tabular-nums">{dayNumber(key)}</span>
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
						class:cut-l={bar.continuesBefore}
						class:cut-r={bar.continuesAfter}
						style="grid-column: {bar.startCol + 2} / {bar.endCol + 3}; grid-row: {bar.lane +
							1}; --stripe: {stripeColor(bar.event.members)}; --m: var(--color-{bar.event.members[0]
							?.color ?? 'ink-muted'})"
						onclick={() => onselect(bar.event)}
					>
						<span class="truncate text-body font-extrabold">{bar.event.title}</span>
					</button>
				{/each}
			</div>
		{/if}
	</div>

	<div class="body">
		<div class="lines" aria-hidden="true">
			{#each hourList as h (h)}
				<div class="line" style="top: {pct(h * 60)}">
					<span class="gutter text-caption text-ink-muted">{hourLabel(h)}</span>
				</div>
			{/each}
		</div>
		<div class="cols grid">
			<span></span>
			{#each keys as key, i (key)}
				<div class="col" class:today={key === today}>
					{#each columns[i] as seg (seg.event.id)}
						<button
							type="button"
							class="block-ev press"
							style="top: {pct(seg.startMin)}; height: {(seg.endMin - seg.startMin) /
								(span / 100)}%; left: {(seg.lane / seg.lanes) * 100}%; width: {100 /
								seg.lanes}%; --stripe: {stripeColor(seg.event.members)}; --m: var(--color-{seg.event
								.members[0]?.color ?? 'ink-muted'})"
							onclick={() => onselect(seg.event)}
						>
							{#if seg.endMin - seg.startMin <= 45}
								<span class="block truncate text-caption leading-tight font-extrabold"
									>{shortTime(seg.event.startsAt, tz)} {seg.event.title}</span
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
					{#if key === today && nowMin >= hours.from * 60 && nowMin <= hours.to * 60}
						<div class="now" style="top: {pct(nowMin)}" aria-hidden="true"></div>
					{/if}
				</div>
			{/each}
		</div>
	</div>
</div>

<style>
	.week {
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
		min-height: 3rem;
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
		min-height: calc(var(--hours) * 2.25rem);
		flex: 1;
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
		position: relative;
		border-left: 2px solid var(--color-line);
	}
	.col.today {
		background: color-mix(in oklch, var(--color-accent) 7%, transparent);
	}
	.block-ev {
		position: absolute;
		overflow: hidden;
		padding: 0.375rem 0.625rem;
		border: 0;
		border-radius: var(--radius-control);
		padding-left: 1.25rem;
		background:
			var(--stripe) left / 0.375rem 100% no-repeat,
			color-mix(in oklab, var(--m) 30%, var(--color-surface-raised));
		color: var(--color-ink);
		text-align: left;
		outline: 2px solid var(--color-surface);
	}
	.block-ev .title {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 3;
		line-clamp: 3;
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
