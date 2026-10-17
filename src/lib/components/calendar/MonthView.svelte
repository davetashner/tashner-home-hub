<script lang="ts">
	import {
		dayNumber,
		shortTime,
		stripeColor,
		weekdayShort
	} from '#lib/domain/calendar-view/format.js';
	import {
		bucketByDay,
		isBanner,
		spanBars,
		type CalEvent
	} from '#lib/domain/calendar-view/layout.js';
	import { range, sameMonth, type DateKey } from '#lib/domain/calendar-view/zone.js';

	interface Props {
		events: CalEvent[];
		keys: DateKey[];
		anchor: DateKey;
		today: DateKey;
		tz: string;
		/** Event lines that fit under the date number in one cell. */
		lines: number;
		onday: (key: DateKey) => void;
	}
	let { events, keys, anchor, today, tz, lines, onday }: Props = $props();

	const weeks = $derived(
		Array.from({ length: keys.length / 7 }, (_, w) => {
			const week = keys.slice(w * 7, w * 7 + 7);
			const bars = spanBars(events, week, tz).filter((b) => b.lane < (lines >= 5 ? 2 : 1));
			const barLanes = bars.reduce((n, b) => Math.max(n, b.lane + 1), 0);
			const buckets = bucketByDay(events, week, tz);
			const cells = week.map((key, col) => {
				const all = buckets.get(key)!;
				const barsHere = bars.filter((b) => b.startCol <= col && b.endCol >= col).length;
				const timed = all.filter((e) => !isBanner(e));
				const room = Math.max(0, lines - barLanes);
				const overflow = timed.length > room || all.length > barsHere + timed.length;
				const chips = timed.slice(0, overflow ? Math.max(0, room - 1) : room);
				return { key, chips, more: all.length - barsHere - chips.length, total: all.length };
			});
			return { week, bars, barLanes, cells };
		})
	);
	const labels = $derived(range(keys[0], 7));
</script>

<div class="month" style="--weeks: {weeks.length}">
	<div class="dow">
		{#each labels as k (k)}
			<span class="text-body font-extrabold text-ink-muted uppercase">{weekdayShort(k)}</span>
		{/each}
	</div>
	{#each weeks as w (w.week[0])}
		<div class="week">
			<div class="bg">
				{#each w.cells as cell (cell.key)}
					<button
						type="button"
						class="cell"
						class:out={!sameMonth(cell.key, anchor)}
						class:today={cell.key === today}
						aria-label="{cell.key}, {cell.total} events"
						onclick={() => onday(cell.key)}
					></button>
				{/each}
			</div>
			<div class="fg" style="--bar-rows: {w.barLanes}">
				{#each w.cells as cell, i (cell.key)}
					<span
						class="num text-lead font-extrabold tabular-nums"
						style="grid-column: {i + 1}; grid-row: 1"
						><span class:pill={cell.key === today}>{dayNumber(cell.key)}</span></span
					>
				{/each}
				{#each w.bars as bar (bar.event.id + bar.startCol)}
					<span
						class="bar truncate text-caption font-extrabold"
						style="grid-column: {bar.startCol + 1} / {bar.endCol + 2}; grid-row: {bar.lane +
							2}; --m: var(--color-{bar.event.members[0]?.color ??
							'ink-muted'}); --stripe: {stripeColor(bar.event.members)}">{bar.event.title}</span
					>
				{/each}
				{#each w.cells as cell, i (cell.key)}
					<div class="chips" style="grid-column: {i + 1}; grid-row: {w.barLanes + 2}">
						{#each cell.chips as ev (ev.id)}
							<span
								class="chip text-caption"
								style="--m: var(--color-{ev.members[0]?.color ?? 'ink-muted'})"
							>
								<span class="dot"></span>
								<span class="truncate"
									><b class="font-extrabold">{shortTime(ev.startsAt, tz)}</b> {ev.title}</span
								>
							</span>
						{/each}
						{#if cell.more > 0}
							<span class="more text-caption font-extrabold text-ink-muted">+{cell.more} more</span>
						{/if}
					</div>
				{/each}
			</div>
		</div>
	{/each}
</div>

<style>
	.month {
		display: grid;
		height: 100%;
		/* Weeks never get squeezed below a tap target, however short the pane (phones scroll). */
		min-height: calc(var(--weeks) * var(--spacing-tap) + 3rem);
		container-type: inline-size;
		grid-template-rows: auto repeat(var(--weeks), minmax(0, 1fr));
		border-radius: var(--radius-card);
		overflow: hidden;
		border: 2px solid var(--color-line);
		background: var(--color-surface-raised);
	}
	.dow,
	.bg,
	.fg {
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
	}
	.dow {
		padding: 0.5rem 0;
		background: var(--color-surface-sunken);
		text-align: center;
	}
	.week {
		position: relative;
		min-height: 0;
		border-top: 2px solid var(--color-line);
	}
	.bg {
		position: absolute;
		inset: 0;
	}
	.fg {
		position: relative;
		height: 100%;
		grid-template-rows: auto repeat(var(--bar-rows), auto) minmax(0, 1fr);
		row-gap: 0.25rem;
		overflow: hidden;
		pointer-events: none;
	}
	.cell {
		border-left: 2px solid var(--color-line);
		cursor: pointer;
	}
	.cell:first-child {
		border-left: 0;
	}
	.cell.out {
		background: var(--color-surface-sunken);
	}
	.cell.today {
		background: var(--color-accent-soft);
	}
	.cell:active {
		background: var(--color-line);
	}
	.cell:focus-visible {
		outline: 4px solid var(--color-accent);
		outline-offset: -4px;
	}
	.num {
		padding: 0.375rem 0.75rem 0;
		line-height: 1.2;
	}
	.pill {
		display: inline-grid;
		min-width: 2.75rem;
		place-items: center;
		border-radius: var(--radius-chip);
		background: var(--color-accent);
		color: var(--color-on-accent);
	}
	.bar {
		min-height: calc(var(--text-caption) * 1.4);
		margin: 0 0.25rem;
		padding: 0.125rem 0.75rem;
		border-radius: var(--radius-control);
		background: color-mix(in oklab, var(--m) 30%, var(--color-surface-raised));
		box-shadow: inset 0.375rem 0 0 0 var(--m);
		padding-left: 1rem;
		color: var(--color-ink);
	}
	.chips {
		display: flex;
		min-height: 0;
		flex-direction: column;
		gap: 0.125rem;
		overflow: hidden;
		padding: 0 0.5rem;
	}
	.chip {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		line-height: 1.3;
		color: var(--color-ink);
	}
	.dot {
		width: 0.75rem;
		height: 0.75rem;
		flex: none;
		border-radius: var(--radius-chip);
		background: var(--m);
	}
	.more {
		padding-left: 1.25rem;
	}
	/*
	 * Seven columns in a narrow pane (phone, iPad landscape beside the rail) cannot hold event
	 * text: cells show a coloured dot per event, and tapping a day opens its agenda.
	 */
	@container (max-width: 700px) {
		.dow span {
			font-size: var(--text-caption);
		}
		.num {
			padding: 0.25rem 0.25rem 0;
			text-align: center;
			font-size: var(--text-body);
		}
		.pill {
			min-width: 2rem;
		}
		.chips {
			flex-flow: row wrap;
			justify-content: center;
			gap: 0.25rem;
			padding: 0 0.25rem;
		}
		.chip {
			gap: 0;
		}
		.chip .truncate,
		.more {
			display: none;
		}
	}
</style>
