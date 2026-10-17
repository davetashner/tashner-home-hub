<script lang="ts">
	import { DESTINATION_URLS } from './urls.js';
	import Icon from './Icon.svelte';
	import { isActive, type Destination } from '#lib/domain/nav.js';
	import {
		clear,
		markClicked,
		optimisticHref,
		tap,
		watchNavigation
	} from './nav-pending.svelte.js';

	let { destination, active }: { destination: Destination; active: boolean } = $props();

	// Between pointerdown and the route landing (tap or swipe) the target looks active and the old
	// item does not. If the navigation fails or is cancelled this falls back to the real route.
	// aria-current stays on the real route: assistive tech should hear a page change only once it
	// has happened, so the optimistic state is a visual-only data attribute.
	const pendingHref = $derived(optimisticHref());
	const shown = $derived(pendingHref ? isActive(destination.href, pendingHref) : active);

	$effect(watchNavigation);
	// Landing on a new route ends any pending tap; so does tapping the item that is already active.
	$effect(() => {
		void active;
		clear();
	});

	function onpointerdown(e: PointerEvent) {
		if (e.button === 0 && !active) tap(destination.href);
	}
</script>

<!-- URL already built with resolve() in urls.ts. -->
<!-- eslint-disable svelte/no-navigation-without-resolve -->
<a
	href={DESTINATION_URLS[destination.href]}
	aria-current={active ? 'page' : undefined}
	{onpointerdown}
	onpointercancel={clear}
	onclick={markClicked}
	onpointerleave={() => {}}
	data-selected={shown ? 'true' : undefined}
	data-sveltekit-preload-data="tap"
	class="nav-item flex min-h-tap min-w-0 flex-1 items-center justify-center gap-4 rounded-control px-6 py-4 text-lead font-extrabold max-sm:px-1 max-sm:text-caption portrait:flex-col portrait:gap-2 portrait:text-body landscape:flex-none landscape:justify-start landscape:py-5 short:min-w-tap short:flex-none short:justify-center short:px-0 short:py-2 tablet:gap-1 tablet:px-1 tablet:text-caption portrait:tablet:py-1 landscape:tablet:flex-col landscape:tablet:justify-center landscape:tablet:py-2 {shown
		? 'bg-accent-soft text-accent'
		: 'text-ink-muted'}"
>
	<span class="text-title tablet:text-lead tablet:leading-none"
		><Icon name={destination.icon} /></span
	>
	<span class="whitespace-nowrap max-sm:sr-only short:sr-only tablet:leading-tight"
		>{destination.label}</span
	>
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
