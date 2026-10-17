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
	import IdleWatcher from './IdleWatcher.svelte';
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
		// Leave grown-up screens now; wait for that navigation before reloading data, or the
		// reload would race it and land on /unlock instead of home.
		const leaving = pathname.startsWith('/settings') ? goto(resolve('/(app)')) : Promise.resolve();
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
		await leaving.catch(() => {});
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

{#if page.data.displayRole === 'wall'}
	<IdleWatcher />
{/if}

<div
	class="grid h-full bg-surface portrait:grid-cols-1 portrait:grid-rows-shell-portrait landscape:grid-cols-shell-landscape landscape:grid-rows-shell-landscape"
>
	<header
		class="flex items-center justify-between gap-3 pt-safe-4 pr-safe-4 pb-4 pl-safe-4 max-sm:justify-end max-sm:pt-safe-2 max-sm:pr-safe-3 max-sm:pb-2 max-sm:pl-safe-3 sm:flex-wrap sm:gap-8 sm:pt-safe-8 sm:pr-safe-12 sm:pb-8 sm:pl-safe-12 portrait:sm:pr-safe-10 portrait:sm:pl-safe-10 landscape:col-start-2 landscape:row-start-1 landscape:pl-4 landscape:sm:gap-4 landscape:sm:pr-safe-8 landscape:sm:pl-8"
	>
		{#if pathname === '/'}
			<span class="max-sm:hidden"></span>
		{:else}
			<div class="min-w-0 max-sm:hidden landscape:flex-1 landscape:sm:min-w-min">
				<a
					href={resolve('/(app)')}
					data-sveltekit-preload-data="tap"
					class="press-link block w-fit max-w-full min-w-0 rounded-control"
				>
					<Clock testidPrefix="header-clock" />
				</a>
			</div>
		{/if}
		<div
			class="ml-auto flex items-center justify-end gap-2 sm:flex-wrap sm:gap-4 portrait:sm:gap-2 landscape:sm:gap-2"
		>
			<OfflineBadge />
			<ApprovalsBadge />
			<Button
				onclick={sleep}
				size="kid"
				class="gap-3 rounded-chip max-sm:!min-h-tap max-sm:!min-w-tap max-sm:!px-4"
			>
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
				class="press-link inline-flex size-tap-kid items-center justify-center rounded-chip border-2 border-line bg-surface-raised text-title text-ink shadow-raised max-sm:!size-tap"
			>
				<Icon name="settings" />
			</a>
		</div>
	</header>

	<nav
		aria-label="Main"
		class="flex gap-2 border-line bg-surface-sunken p-4 max-sm:gap-1 max-sm:p-2 portrait:row-start-3 portrait:border-t-2 portrait:pt-4 portrait:pr-safe-4 portrait:pb-safe-4 portrait:pl-safe-4 portrait:max-sm:pt-2 portrait:max-sm:pr-safe-2 portrait:max-sm:pb-safe-2 portrait:max-sm:pl-safe-2 landscape:col-start-1 landscape:row-span-2 landscape:row-start-1 landscape:w-rail landscape:flex-col landscape:gap-3 landscape:border-r-2 landscape:pt-safe-8 landscape:pr-5 landscape:pb-safe-8 landscape:pl-safe-5"
	>
		{#each DESTINATIONS as destination (destination.id)}
			<NavItem {destination} active={isActive(destination.href, pathname)} />
		{/each}
	</nav>

	<!-- The page scrolls here; tabindex lets keyboard users scroll it even when it has no focusable content (axe scrollable-region-focusable). -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<main
		use:swipe={{ onswipe }}
		tabindex="0"
		class="min-h-0 touch-pan-y overflow-y-auto portrait:row-start-2 landscape:col-start-2 landscape:row-start-2 landscape:pr-safe-0 landscape:pb-safe-0"
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
