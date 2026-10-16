<script lang="ts">
	import { onMount } from 'svelte';
	import { formatClock } from '#lib/domain/clock.js';

	let now = $state(new Date());

	onMount(() => {
		const timer = setInterval(() => (now = new Date()), 1000);
		return () => clearInterval(timer);
	});

	const clock = $derived(formatClock(now));
</script>

<svelte:head>
	<title>Home Hub</title>
</svelte:head>

<main class="flex h-full flex-col items-center justify-center gap-4 p-8">
	<p class="text-display font-bold tabular-nums" data-testid="clock-time">{clock.time}</p>
	<p class="text-title text-ink-muted" data-testid="clock-date">{clock.date}</p>
</main>
