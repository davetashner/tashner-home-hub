<script lang="ts">
	import type { Snippet } from 'svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { swipe } from '#lib/actions/swipe.js';
	import Button from '#lib/components/ui/Button.svelte';
	import { DESTINATIONS, isActive, swipeTarget } from '#lib/domain/nav.js';
	import { DESTINATION_URLS } from './urls.js';
	import OfflineBadge from './OfflineBadge.svelte';
	import ApprovalsBadge from './ApprovalsBadge.svelte';
	import Clock from './Clock.svelte';
	import Icon from './Icon.svelte';
	import NavItem from './NavItem.svelte';

	let { children }: { children: Snippet } = $props();

	const pathname = $derived(page.url.pathname);

	function sleep() {
		// Optimistic: never block the tap on the network (SLP-2).
		void fetch('/api/display/sleep', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{}'
		}).catch(() => {});
	}

	// Optimistic lock: hide the control and leave grown-up screens on the tap, then end the session.
	let locking = $state(false);
	const adult = $derived(page.data.adult === true && !locking);

	async function lock() {
		locking = true;
		if (pathname.startsWith('/settings')) void goto(resolve('/(app)'));
		try {
			// JSON body: an empty-body POST trips SvelteKit's CSRF origin check.
			await fetch('/api/auth/logout', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{}'
			});
		} catch {
			// Offline: the wall session still times out on its own; the reload below shows the truth.
		}
		await invalidateAll().finally(() => (locking = false));
	}

	function onswipe(direction: 'left' | 'right' | 'up' | 'down') {
		if (direction !== 'left' && direction !== 'right') return;
		const target = swipeTarget(pathname, direction);
		// URL already built with resolve() in urls.ts.
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		if (target) void goto(DESTINATION_URLS[target]);
	}
</script>

<div
	class="grid h-full bg-surface portrait:grid-cols-[minmax(0,1fr)] portrait:grid-rows-[auto_1fr_auto] landscape:grid-cols-[auto_1fr] landscape:grid-rows-[auto_1fr]"
>
	<header
		class="flex items-center justify-between gap-3 px-4 py-4 max-sm:justify-end sm:gap-8 sm:px-12 sm:py-8 portrait:sm:px-10 landscape:col-start-2 landscape:row-start-1"
	>
		{#if pathname === '/'}
			<span class="max-sm:hidden"></span>
		{:else}
			<a
				href={resolve('/(app)')}
				data-sveltekit-preload-data="tap"
				class="press-link block rounded-control max-sm:hidden"
			>
				<Clock testidPrefix="header-clock" />
			</a>
		{/if}
		<div class="flex items-center gap-2 sm:gap-4">
			<OfflineBadge />
			<ApprovalsBadge />
			<Button onclick={sleep} size="kid" class="gap-3 rounded-chip max-sm:!px-5">
				<span class="text-lead"><Icon name="moon" /></span>
				<span class="max-sm:sr-only">Sleep</span>
			</Button>
			{#if adult}
				<Button
					onclick={lock}
					variant="secondary"
					size="kid"
					class="gap-3 rounded-chip max-sm:!min-h-tap max-sm:!min-w-tap max-sm:!px-0"
				>
					<span class="text-lead"><Icon name="lock" /></span>
					<span class="max-sm:sr-only">Lock</span>
				</Button>
			{/if}
			<a
				href={resolve('/(app)/settings')}
				aria-label="Settings"
				data-sveltekit-preload-data="tap"
				class="press-link inline-flex size-tap-kid items-center justify-center rounded-chip border-2 border-line bg-surface-raised text-title text-ink shadow-raised"
			>
				<Icon name="settings" />
			</a>
		</div>
	</header>

	<nav
		aria-label="Main"
		class="flex gap-2 border-line bg-surface-sunken p-4 max-sm:gap-1 max-sm:px-2 portrait:row-start-3 portrait:border-t-2 portrait:px-4 portrait:py-4 landscape:col-start-1 landscape:row-span-2 landscape:row-start-1 landscape:w-rail landscape:flex-col landscape:gap-3 landscape:border-r-2 landscape:px-5 landscape:py-8"
	>
		{#each DESTINATIONS as destination (destination.id)}
			<NavItem {destination} active={isActive(destination.href, pathname)} />
		{/each}
	</nav>

	<main
		use:swipe={{ onswipe }}
		class="min-h-0 touch-pan-y overflow-y-auto portrait:row-start-2 landscape:col-start-2 landscape:row-start-2"
	>
		{#key pathname}
			<div class="page-enter h-full">
				{@render children()}
			</div>
		{/key}
	</main>
</div>

<style>
	.press-link {
		transition:
			transform var(--duration-quick) var(--ease-out-soft),
			opacity var(--duration-quick) linear;
	}
	.press-link:active {
		transform: scale(0.95);
		opacity: 0.8;
		transition-duration: var(--duration-instant);
	}
	.press-link:focus-visible {
		outline: 4px solid var(--color-accent);
		outline-offset: 4px;
	}
</style>
