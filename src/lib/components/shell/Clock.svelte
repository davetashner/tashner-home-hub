<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { formatClock } from '#lib/domain/clock.js';
	import { isTimeZone } from '#lib/domain/time-zone.js';

	let {
		testidPrefix = 'clock',
		size = 'header'
	}: { testidPrefix?: string; size?: 'header' | 'hero' } = $props();

	let now = $state(new Date());

	onMount(() => {
		const timer = setInterval(() => (now = new Date()), 1000);
		return () => clearInterval(timer);
	});

	// The household zone when the server sent one, so the wall shows home time whatever the kiosk thinks.
	const zone = $derived(isTimeZone(page.data.timeZone) ? page.data.timeZone : undefined);
	const clock = $derived(formatClock(now, zone ? { timeZone: zone } : {}));
</script>

<div
	class="flex flex-col {size === 'hero'
		? 'items-center gap-4'
		: 'max-w-full min-w-0 items-start gap-1'}"
>
	<p
		class="leading-none font-extrabold whitespace-nowrap tabular-nums {size === 'hero'
			? 'text-display'
			: 'text-headline tablet:text-lead'}"
		data-testid="{testidPrefix}-time"
	>
		{clock.time}
	</p>
	<p
		class="text-ink-muted {size === 'hero'
			? 'text-title'
			: 'text-lead tablet:text-caption tablet:whitespace-nowrap'}"
		data-testid="{testidPrefix}-date"
	>
		{clock.date}
	</p>
</div>
