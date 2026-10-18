<script lang="ts">
	import MemberAvatar from '#lib/components/MemberAvatar.svelte';
	import { dayHeading, dayTimeLabel, stripeColor } from '#lib/domain/calendar-view/format.js';
	import { agendaNowIndex } from '#lib/domain/calendar-view/now-line.js';
	import { bucketByDay, type CalEvent } from '#lib/domain/calendar-view/layout.js';
	import type { MemberColor } from '#lib/domain/member-colors.js';
	import type { DateKey } from '#lib/domain/calendar-view/zone.js';

	interface Props {
		events: CalEvent[];
		keys: DateKey[];
		today: DateKey;
		tz: string;
		/** Epoch ms; when given, today's list shows a "Now" divider. */
		now?: number;
		onselect: (event: CalEvent) => void;
		/** List every day of the period, quiet ones included (the Week view on a narrow pane). */
		all?: boolean;
	}
	let { events, keys, today, tz, now, onselect, all = false }: Props = $props();

	const days = $derived(bucketByDay(events, keys, tz));
	// Quiet days are skipped, except today, which always anchors the list.
	const shown = $derived(all ? keys : keys.filter((k) => days.get(k)!.length > 0 || k === today));
</script>

<div class="days-wrap">
	<div class="days">
		{#each shown as key (key)}
			{@const heading = dayHeading(key, today)}
			{@const list = days.get(key)!}
			<section class="day" aria-label={heading.rest}>
				<h2 class="mb-3 flex items-baseline gap-4 px-2">
					<span class="text-title font-extrabold {key === today ? 'text-accent' : ''}"
						>{heading.lead}</span
					>
					<span class="text-lead text-ink-muted">{heading.rest}</span>
				</h2>
				{#if list.length === 0}
					<p
						class="rounded-card border-2 border-dashed border-line px-8 py-6 text-lead text-ink-muted"
					>
						Nothing planned. Enjoy the day.
					</p>
				{:else}
					{@const nowAt = key === today && now !== undefined ? agendaNowIndex(list, now) : -1}
					<ul class="flex flex-col gap-3">
						{#each list as ev, i (ev.id)}
							{#if i === nowAt}
								<li class="now-row" data-testid="now-line" aria-label="Now"><span>Now</span></li>
							{/if}
							<li>
								<button
									type="button"
									class="row press"
									class:pending={ev.pending}
									data-pending={ev.pending ? 'true' : undefined}
									style="--stripe: {stripeColor(ev.members)}; --m: var(--color-{ev.members[0]
										?.color ?? 'ink-muted'})"
									onclick={() => onselect(ev)}
								>
									<span class="time text-body font-extrabold tabular-nums">
										{dayTimeLabel(ev, key, tz)}
									</span>
									<span class="stripe" aria-hidden="true"></span>
									<span class="body min-w-0 text-left">
										<span class="block truncate text-lead font-extrabold">{ev.title}</span>
										{#if ev.location}
											<span class="block truncate text-body text-ink-muted">{ev.location}</span>
										{/if}
									</span>
									<span class="avatars flex -space-x-3">
										{#each ev.members as m (m.id)}
											<MemberAvatar name={m.name} color={m.color as MemberColor} size="sm" />
										{/each}
									</span>
								</button>
							</li>
						{/each}
						{#if nowAt === list.length}
							<li class="now-row" data-testid="now-line" aria-label="Now"><span>Now</span></li>
						{/if}
					</ul>
				{/if}
			</section>
		{/each}
	</div>
</div>

<style>
	.now-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		color: var(--color-danger);
		font-size: var(--text-caption);
		font-weight: 800;
		text-transform: uppercase;
	}
	.now-row::after {
		height: 0.25rem;
		flex: 1;
		background: var(--color-danger);
		content: '';
	}

	.days {
		display: block;
		column-gap: 3rem;
	}
	.days-wrap {
		container-type: inline-size;
	}
	/* Two columns only when each can hold a full row; a narrower landscape pane stays single. */
	@container (min-width: 900px) {
		.days {
			columns: 2;
		}
	}
	.day {
		break-inside: avoid;
		margin-bottom: 2rem;
		container-type: inline-size;
	}
	.row {
		display: grid;
		grid-template-columns: 7rem auto minmax(0, 1fr) auto;
		grid-template-areas: 'time stripe body avatars';
		width: 100%;
		min-height: var(--spacing-tap);
		align-items: center;
		gap: 1.25rem;
		padding: 1rem 1.5rem 1rem 1.25rem;
		border-radius: var(--radius-card);
		background: color-mix(in oklab, var(--m) 14%, var(--color-surface-raised));
		color: var(--color-ink);
		box-shadow: var(--shadow-raised);
	}
	.time {
		grid-area: time;
		text-align: right;
		color: var(--color-ink-muted);
	}
	.body {
		grid-area: body;
	}
	.avatars {
		grid-area: avatars;
	}
	/*
	 * A narrow column (phone, iPad landscape's two columns) cannot spare a time gutter beside
	 * the title: the time moves above it and the stripe runs down the left edge.
	 */
	@container (max-width: 520px) {
		.row {
			grid-template-columns: auto minmax(0, 1fr) auto;
			grid-template-areas:
				'stripe time avatars'
				'stripe body avatars';
			gap: 0.25rem 1rem;
			padding: 0.75rem 1rem 0.75rem 0.75rem;
		}
		.time {
			text-align: left;
		}
	}
	.stripe {
		grid-area: stripe;
		align-self: stretch;
		width: 0.5rem;
		border-radius: var(--radius-chip);
		background: var(--stripe);
	}
	.row.pending {
		opacity: 0.6;
		outline: 3px dashed var(--color-line);
		outline-offset: -3px;
	}
	.press {
		cursor: pointer;
		transition: transform var(--duration-quick) var(--ease-out-soft);
	}
	.press:active {
		transform: scale(0.98);
		transition-duration: var(--duration-instant);
	}
	.press:focus-visible {
		outline: 4px solid var(--color-accent);
		outline-offset: 4px;
	}
</style>
