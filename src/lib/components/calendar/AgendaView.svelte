<script lang="ts">
	import MemberAvatar from '#lib/components/MemberAvatar.svelte';
	import { dayHeading, dayTimeLabel, stripeColor } from '#lib/domain/calendar-view/format.js';
	import { bucketByDay, type CalEvent } from '#lib/domain/calendar-view/layout.js';
	import type { MemberColor } from '#lib/domain/member-colors.js';
	import type { DateKey } from '#lib/domain/calendar-view/zone.js';

	interface Props {
		events: CalEvent[];
		keys: DateKey[];
		today: DateKey;
		tz: string;
		onselect: (event: CalEvent) => void;
	}
	let { events, keys, today, tz, onselect }: Props = $props();

	const days = $derived(bucketByDay(events, keys, tz));
	// Quiet days are skipped, except today, which always anchors the list.
	const shown = $derived(keys.filter((k) => days.get(k)!.length > 0 || k === today));
</script>

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
				<ul class="flex flex-col gap-3">
					{#each list as ev (ev.id)}
						<li>
							<button
								type="button"
								class="row press"
								style="--stripe: {stripeColor(ev.members)}; --m: var(--color-{ev.members[0]
									?.color ?? 'ink-muted'})"
								onclick={() => onselect(ev)}
							>
								<span class="time text-body font-extrabold tabular-nums">
									{dayTimeLabel(ev, key, tz)}
								</span>
								<span class="stripe" aria-hidden="true"></span>
								<span class="min-w-0 flex-1 text-left">
									<span class="block truncate text-lead font-extrabold">{ev.title}</span>
									{#if ev.location}
										<span class="block truncate text-body text-ink-muted">{ev.location}</span>
									{/if}
								</span>
								<span class="flex -space-x-3">
									{#each ev.members as m (m.id)}
										<MemberAvatar name={m.name} color={m.color as MemberColor} size="sm" />
									{/each}
								</span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/each}
</div>

<style>
	.days {
		display: block;
		column-gap: 3rem;
	}
	@media (orientation: landscape) {
		.days {
			columns: 2;
		}
	}
	.day {
		break-inside: avoid;
		margin-bottom: 2rem;
	}
	.row {
		display: flex;
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
		width: 7rem;
		flex: none;
		text-align: right;
		color: var(--color-ink-muted);
	}
	.stripe {
		align-self: stretch;
		width: 0.5rem;
		flex: none;
		border-radius: var(--radius-chip);
		background: var(--stripe);
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
