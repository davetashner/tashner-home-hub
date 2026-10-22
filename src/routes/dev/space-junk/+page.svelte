<script lang="ts">
	import SpaceJunkCanvas from '#lib/components/space-junk/SpaceJunkCanvas.svelte';
	import { TEST_TOWER } from '#lib/domain/space-junk/fixtures.js';
</script>

<svelte:head><title>Space Junk (dev)</title></svelte:head>

<div class="h-dvh bg-frame">
	<SpaceJunkCanvas level={TEST_TOWER} />
</div>
