<script lang="ts">
	import WeatherWidget from '#lib/components/weather/WeatherWidget.svelte';
	import Clock from '#lib/components/shell/Clock.svelte';
	import HomeCountdowns from '#lib/components/home/HomeCountdowns.svelte';
	import HomeWeek from '#lib/components/home/HomeWeek.svelte';
	import HomeControls from '#lib/components/home/HomeControls.svelte';
	import Icon from '#lib/components/shell/Icon.svelte';
	import { timerState } from '#lib/components/timers/timers-state.svelte.js';
	import SportsStrip from '#lib/components/home/SportsStrip.svelte';

	// Game days add the sports strip: tighten the spacing so Notes and its buttons stay on screen
	// and clear of the corner decorations (the birthday cake).
	let sportsShown = $state(false);
	import HomeNotes from '#lib/components/home/HomeNotes.svelte';
	import { page } from '$app/state';
	import SitterHome from '#lib/components/home/SitterHome.svelte';
	import { sitter } from '#lib/components/shell/sitter-state.svelte.js';
	import { sitterLocks } from '#lib/domain/sitter.js';

	// While a sitter session runs, the wall's home is tonight's plan (hub-7pj.2).
	const sitterHome = $derived(
		page.data.displayRole === 'wall' &&
			sitterLocks(sitter.session, sitter.now, page.data.adult === true).sitterView
	);
</script>

<svelte:head>
	<title>Home Hub</title>
</svelte:head>

{#if sitterHome}
	<SitterHome />
{:else}
	<!-- One screen tall: the week calendar takes the space left and scrolls inside (hub-b4z.3).
	     Phones stack everything and the page scrolls instead. -->
	<div
		class="flex h-full flex-col p-12 pb-corner-sprite {sportsShown
			? 'gap-6'
			: 'gap-8'} max-sm:h-auto max-sm:min-h-full short:h-auto short:min-h-full short:gap-3 short:p-3 tablet:gap-6 tablet:p-6"
	>
		<!-- The clock with the countdown pills beside it (CD-2, mockup B), then the weather.
		     Phone landscape: clock, weather and pills share one row to save height. -->
		<div
			class="flex flex-wrap items-center gap-x-12 gap-y-6 short:flex-nowrap short:gap-3 tablet:gap-6"
		>
			<div class="min-w-0 flex-1 short:flex-none"><Clock testidPrefix="clock" size="hero" /></div>
			<div
				class="order-last basis-full empty:hidden short:order-none short:min-w-0 short:flex-1 short:basis-0"
			>
				<WeatherWidget />
			</div>
			<HomeCountdowns />
		</div>
		<HomeWeek />
		<!-- Game days: the scores sit under the week, above Notes and its drawing board. -->
		<SportsStrip onshown={(shown) => (sportsShown = shown)} />
		<!-- The header Timers button is hidden on phone, tablet and short layouts; this stands in. -->
		<button
			type="button"
			onclick={() => (timerState.panel = true)}
			data-testid="timer-open-home"
			class="press-link hidden min-h-tap items-center justify-center gap-3 rounded-card border-2 border-control-line bg-control px-6 text-body font-extrabold text-ink shadow-raised max-sm:inline-flex short:inline-flex tablet:inline-flex"
		>
			<span class="text-lead"><Icon name="timer" /></span>
			Timers
		</button>
		<HomeControls />
		<HomeNotes />
	</div>
{/if}
