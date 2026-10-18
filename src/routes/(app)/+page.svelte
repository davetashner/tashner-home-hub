<script lang="ts">
	import Card from '#lib/components/ui/Card.svelte';
	import WeatherWidget from '#lib/components/weather/WeatherWidget.svelte';
	import Clock from '#lib/components/shell/Clock.svelte';
	import HomeCountdowns from '#lib/components/home/HomeCountdowns.svelte';
	import Icon from '#lib/components/shell/Icon.svelte';
	import { timerState } from '#lib/components/timers/timers-state.svelte.js';
	import HomeNotes from '#lib/components/home/HomeNotes.svelte';
	import { page } from '$app/state';
	import { TODO_FALLBACK } from '#lib/domain/nav.js';

	const tiles = $derived([
		{ title: 'Today', line: 'Events and reminders will appear here.' },
		{ title: page.data.todoLabel ?? TODO_FALLBACK, line: 'Who has what, and the stars earned.' },
		{ title: 'Dinner', line: "Tonight's plan at a glance." }
	]);
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
	<!-- The header Timers button is hidden on phone, tablet and short layouts; this stands in. -->
	<button
		type="button"
		onclick={() => (timerState.panel = true)}
		data-testid="timer-open-home"
		class="press-link hidden min-h-tap items-center justify-center gap-3 rounded-card border-2 border-line bg-surface-raised px-6 text-body font-extrabold text-ink shadow-raised max-sm:inline-flex short:inline-flex tablet:inline-flex"
	>
		<span class="text-lead"><Icon name="timer" /></span>
		Timers
	</button>
	<HomeCountdowns />
	<HomeNotes />
</div>
