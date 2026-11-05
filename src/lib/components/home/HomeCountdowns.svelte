<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import {
		countdownDay,
		dayIn,
		upcomingCountdowns,
		type CountdownLike
	} from '#lib/domain/countdowns.js';
	import { isTimeZone, runtimeZone } from '#lib/domain/time-zone.js';

	let all = $state<CountdownLike[]>([]);
	let now = $state(Date.now());

	onMount(() => {
		fetch('/api/countdowns')
			.then((r) => (r.ok ? r.json() : []))
			.then((list: CountdownLike[]) => (all = list))
			.catch(() => {});
		// Re-check each minute so a countdown rolls over at household midnight without a reload.
		const timer = setInterval(() => (now = Date.now()), 60_000);
		return () => clearInterval(timer);
	});

	const zone = $derived(isTimeZone(page.data.timeZone) ? page.data.timeZone : runtimeZone());
	// CD-2/CD-3: the two soonest, and only in their last 30 days.
	const upcoming = $derived(upcomingCountdowns(all, dayIn(now, zone)));
</script>

{#if upcoming.length > 0}
	<section aria-label="Countdowns" data-testid="home-countdowns" class="max-sm:basis-full">
		<ul class="flex flex-col gap-4 short:flex-row short:gap-2">
			{#each upcoming as c, i (c.id)}
				<li
					class="flex items-center gap-5 rounded-chip border-2 border-line bg-surface-raised py-2 pr-8 pl-2 short:gap-2 short:py-1 short:pr-3 short:pl-1"
					data-testid="home-countdown"
				>
					<span
						class="flex size-tap-kid-lg shrink-0 flex-col items-center justify-center rounded-chip short:size-tap {i ===
						0
							? 'bg-accent text-on-accent'
							: 'bg-accent-soft text-accent-press'}"
						aria-hidden="true"
					>
						{#if c.days === 0}
							<span class="text-body font-extrabold short:text-caption">Today</span>
						{:else}
							<span class="text-title leading-none font-extrabold short:text-body">{c.days}</span>
							<span class="text-caption font-extrabold uppercase short:hidden"
								>{c.days === 1 ? 'day' : 'days'}</span
							>
						{/if}
					</span>
					<span class="flex min-w-0 flex-col">
						<span class="text-lead leading-tight font-extrabold short:text-caption">
							{#if c.icon}<span aria-hidden="true">{c.icon}</span>{/if}
							{c.title}
						</span>
						<span class="text-body text-ink-muted short:hidden">{countdownDay(c.targetDate)}</span>
						<span class="sr-only" data-testid="countdown-label">{c.label}</span>
					</span>
				</li>
			{/each}
		</ul>
	</section>
{/if}
