<script lang="ts">
	import { onMount } from 'svelte';
	import { formatClock } from '#lib/domain/clock.js';

	let {
		testidPrefix = 'clock',
		size = 'header'
	}: { testidPrefix?: string; size?: 'header' | 'hero' } = $props();

	let now = $state(new Date());

	onMount(() => {
		const timer = setInterval(() => (now = new Date()), 1000);
		return () => clearInterval(timer);
	});

	const clock = $derived(formatClock(now));
</script>

<div class="flex flex-col {size === 'hero' ? 'items-center gap-4' : 'items-start gap-1'}">
	<p
		class="leading-none font-extrabold tabular-nums {size === 'hero'
			? 'text-display'
			: 'text-headline'}"
		data-testid="{testidPrefix}-time"
	>
		{clock.time}
	</p>
	<p
		class="text-ink-muted {size === 'hero' ? 'text-title' : 'text-lead'}"
		data-testid="{testidPrefix}-date"
	>
		{clock.date}
	</p>
</div>
