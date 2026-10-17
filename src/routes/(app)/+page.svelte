<script lang="ts">
	import Card from '#lib/components/ui/Card.svelte';
	import WeatherWidget from '#lib/components/weather/WeatherWidget.svelte';
	import Clock from '#lib/components/shell/Clock.svelte';
	import HomeCountdowns from '#lib/components/home/HomeCountdowns.svelte';

	const tiles = [
		{ title: 'Today', line: 'Events and reminders will appear here.' },
		{ title: 'To-Do List', line: 'Who has what, and the stars earned.' },
		{ title: 'Dinner', line: "Tonight's plan at a glance." }
	];
</script>

<svelte:head>
	<title>Home Hub</title>
</svelte:head>

<div
	class="flex min-h-full flex-col justify-center gap-16 p-12 short:justify-start short:gap-3 short:p-3 tablet:gap-8 tablet:p-6"
>
	<!-- Phone landscape: the clock and the weather share one row to save height. -->
	<div class="contents short:flex short:items-center short:gap-3">
		<Clock testidPrefix="clock" size="hero" />
		<div class="contents short:block short:min-w-0 short:flex-1"><WeatherWidget /></div>
	</div>
	<div class="grid grid-cols-3 gap-8 portrait:grid-cols-1 short:gap-3 tablet:gap-4">
		{#each tiles as tile (tile.title)}
			<Card class="short:p-3 tablet:p-5">
				<h2 class="text-lead font-extrabold short:text-body">{tile.title}</h2>
				<p class="mt-2 text-body text-ink-muted short:mt-1 short:text-caption tablet:text-caption">
					{tile.line}
				</p>
			</Card>
		{/each}
	</div>
	<HomeCountdowns />
</div>
