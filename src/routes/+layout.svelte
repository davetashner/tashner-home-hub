<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { onAppResume } from '#lib/live/resume.js';
	import './layout.css';
	import { startOffline } from '#lib/offline/client.js';
	import favicon from '#lib/assets/favicon.svg';
	import { page } from '$app/state';
	import { appearanceAt } from '#lib/domain/appearance.js';
	import { appearanceState } from '#lib/components/shell/appearance-state.svelte.js';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();

	// Theme (UI-5) and evening dimming (SLP-5), re-evaluated by the one clock tick a minute. No
	// network: the settings, sleep schedule and location arrive with the page data.
	let now = $state(Date.now());
	$effect(() => {
		appearanceState.value = data.appearance.appearance;
	});
	const wall = $derived(data.displayRole === 'wall');
	const framed = $derived(page.state.frame === true || page.url.pathname === '/photos');
	const look = $derived(
		appearanceAt(
			now,
			data.timeZone,
			appearanceState.value,
			data.appearance.schedule,
			data.appearance.location,
			wall,
			framed
		)
	);
	// The design page drives its own theme toggle.
	const owned = $derived(!page.url.pathname.startsWith('/dev'));
	$effect(() => {
		if (!owned) return;
		const root = document.documentElement;
		if (root.dataset.theme !== look.theme) root.dataset.theme = look.theme;
		root.style.filter = look.dim < 1 ? `brightness(${look.dim})` : '';
	});

	onMount(() => {
		const stopOffline = startOffline();
		// iOS freezes a backgrounded page: pick up what changed while it was away.
		const stopResume = onAppResume(() => void invalidateAll());
		const minute = setInterval(() => (now = Date.now()), 60_000);
		return () => {
			clearInterval(minute);
			stopOffline();
			stopResume();
		};
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
