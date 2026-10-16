<script lang="ts">
	import { DESTINATION_URLS } from './urls.js';
	import Icon from './Icon.svelte';
	import type { Destination } from '#lib/domain/nav.js';

	let { destination, active }: { destination: Destination; active: boolean } = $props();
</script>

<!-- URL already built with resolve() in urls.ts. -->
<!-- eslint-disable svelte/no-navigation-without-resolve -->
<a
	href={DESTINATION_URLS[destination.href]}
	aria-current={active ? 'page' : undefined}
	data-sveltekit-preload-data="tap"
	class="nav-item flex min-h-tap flex-1 items-center justify-center gap-4 rounded-control px-6 py-4 text-lead font-extrabold portrait:flex-col portrait:gap-2 portrait:text-body landscape:flex-none landscape:justify-start landscape:py-5 {active
		? 'bg-accent-soft text-accent'
		: 'text-ink-muted'}"
>
	<span class="text-title"><Icon name={destination.icon} /></span>
	<span>{destination.label}</span>
</a>

<style>
	/* Press feedback lands on :active in the same frame; transform/opacity only. */
	.nav-item {
		transition:
			transform var(--duration-quick) var(--ease-out-soft),
			opacity var(--duration-quick) linear;
	}
	.nav-item:active {
		transform: scale(0.95);
		opacity: 0.8;
		transition-duration: var(--duration-instant);
	}
	.nav-item:focus-visible {
		outline: 4px solid var(--color-accent);
		outline-offset: 2px;
	}
</style>
