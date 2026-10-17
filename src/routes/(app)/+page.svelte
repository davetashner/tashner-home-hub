<script lang="ts">
	import Card from '#lib/components/ui/Card.svelte';
	import WeatherWidget from '#lib/components/weather/WeatherWidget.svelte';
	import Clock from '#lib/components/shell/Clock.svelte';

	const tiles = [
		{ title: 'Today', line: 'Events and reminders will appear here.' },
		{ title: 'Chores', line: 'Who has what, and the stars earned.' },
		{ title: 'Dinner', line: "Tonight's plan at a glance." }
	];
</script>

<svelte:head>
	<title>Home Hub</title>
</svelte:head>

<div class="flex h-full flex-col justify-center gap-16 p-12">
	<Clock testidPrefix="clock" size="hero" />
	<WeatherWidget />
	<div class="grid grid-cols-3 gap-8 portrait:grid-cols-1">
		{#each tiles as tile (tile.title)}
			<Card>
				<h2 class="text-lead font-extrabold">{tile.title}</h2>
				<p class="mt-2 text-body text-ink-muted">{tile.line}</p>
			</Card>
		{/each}
	</div>
</div>
