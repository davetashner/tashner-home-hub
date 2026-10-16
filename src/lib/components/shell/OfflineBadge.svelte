<script lang="ts">
	import Badge from '#lib/components/ui/Badge.svelte';
	import { isOffline } from '#lib/offline/state.svelte.js';
</script>

{#if isOffline()}
	<span role="status" data-testid="offline-badge" class="max-sm:hidden">
		<Badge tone="star">Offline — showing saved info</Badge>
	</span>
{/if}
