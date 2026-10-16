<script lang="ts">
	import AppShell from '#lib/components/shell/AppShell.svelte';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();
</script>

<AppShell signedIn={data.adult !== null}>{@render children()}</AppShell>
