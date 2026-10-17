<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import Card from '#lib/components/ui/Card.svelte';
	import { dayIn, upcomingCountdowns, type CountdownLike } from '#lib/domain/countdowns.js';
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
	const upcoming = $derived(upcomingCountdowns(all, dayIn(now, zone)));
</script>

{#if upcoming.length > 0}
	<section aria-label="Countdowns" data-testid="home-countdowns">
		<ul class="grid grid-cols-3 gap-8 portrait:grid-cols-1">
			{#each upcoming as c (c.id)}
				<li>
					<Card class="flex items-center gap-6" data-testid="home-countdown">
						<span class="text-display leading-none" aria-hidden="true">{c.icon ?? '⏳'}</span>
						<span class="flex min-w-0 flex-col gap-1">
							<span class="text-lead font-extrabold" data-testid="countdown-label">{c.label}</span>
							<span class="truncate text-body text-ink-muted">{c.title}</span>
						</span>
					</Card>
				</li>
			{/each}
		</ul>
	</section>
{/if}
