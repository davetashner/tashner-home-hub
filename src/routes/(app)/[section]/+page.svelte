<script lang="ts">
	import { page } from '$app/state';
	import Slideshow from '#lib/components/frame/Slideshow.svelte';
</script>

<svelte:head>
	<title>Photos · Home Hub</title>
</svelte:head>

<Slideshow fullscreen={page.state.frame === true} />
