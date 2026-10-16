<script lang="ts">
	import { onMount } from 'svelte';
	import './layout.css';
	import { startOffline } from '#lib/offline/client.js';
	import favicon from '#lib/assets/favicon.svg';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	onMount(startOffline);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
