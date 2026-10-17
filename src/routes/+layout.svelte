<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { onAppResume } from '#lib/live/resume.js';
	import './layout.css';
	import { startOffline } from '#lib/offline/client.js';
	import favicon from '#lib/assets/favicon.svg';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	onMount(() => {
		const stopOffline = startOffline();
		// iOS freezes a backgrounded page: pick up what changed while it was away.
		const stopResume = onAppResume(() => void invalidateAll());
		return () => {
			stopOffline();
			stopResume();
		};
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
