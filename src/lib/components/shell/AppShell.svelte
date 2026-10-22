<script lang="ts">
	import { onMount, tick, type Snippet } from 'svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { swipe } from '#lib/actions/swipe.js';
	import Button from '#lib/components/ui/Button.svelte';
	import { TODO_FALLBACK, destinationsFor, isActive, swipeTarget } from '#lib/domain/nav.js';
	import { DESTINATION_URLS } from './urls.js';
	import OfflineBadge from './OfflineBadge.svelte';
	import ApprovalsBadge from './ApprovalsBadge.svelte';
	import Clock from './Clock.svelte';
	import Icon from './Icon.svelte';
	import { frameOverlay } from './frame-overlay-state.svelte.js';
	import TimerHost from '#lib/components/timers/TimerHost.svelte';
	import TimerPills from '#lib/components/timers/TimerPills.svelte';
	import { timerState } from '#lib/components/timers/timers-state.svelte.js';
	import IdleWatcher from './IdleWatcher.svelte';
	import NavItem from './NavItem.svelte';
	import NightClock from './NightClock.svelte';
	import WakeGuard from './WakeGuard.svelte';
	import WaveBackground from './WaveBackground.svelte';
	import { wave } from './wave-state.svelte.js';
	import { parseWaveChoice } from '#lib/domain/wave-background.js';
	import { isFunPath, sitterLocks } from '#lib/domain/sitter.js';
	import SitterEmergency from './SitterEmergency.svelte';
	import SitterApprovals from './SitterApprovals.svelte';
	import { sitter, watchSitter } from './sitter-state.svelte.js';

	const NAV_KEY = 'hub.nav.collapsed';
	// Slide-out length: matches --duration-base (240ms) plus a little slack.
	const SLIDE_MS = 260;

	// `collapsed` drives the slide (transform/opacity); `gone` drops the rail from the grid
	// once it has slid out, so the content really gains the width. Only landscape, non-short
	// layouts have a side rail; elsewhere the CSS ignores both flags.
	let collapsed = $state(false);
	let gone = $state(false);
	let handle = $state<HTMLButtonElement>();
	let collapseButton = $state<HTMLButtonElement>();
	let sideRail = $state(false);
	let goneTimer: ReturnType<typeof setTimeout> | undefined;

	// Sitter mode (hub-7pj.2): only the wall display follows a sitter session.
	onMount(() => (page.data.displayRole === 'wall' ? watchSitter() : undefined));

	onMount(() => {
		const media = matchMedia('(orientation: landscape) and (min-height: 32.01rem)');
		const onMedia = () => (sideRail = media.matches);
		onMedia();
		media.addEventListener('change', onMedia);
		try {
			if (localStorage.getItem(NAV_KEY) === '1') {
				collapsed = true;
				gone = true;
			}
		} catch {
			// Storage unavailable: the rail just starts expanded.
		}
		return () => {
			media.removeEventListener('change', onMedia);
			clearTimeout(goneTimer);
		};
	});

	function remember(value: boolean) {
		try {
			localStorage.setItem(NAV_KEY, value ? '1' : '0');
		} catch {
			// Private mode or blocked storage: the choice just does not stick.
		}
	}

	async function collapse() {
		collapsed = true;
		remember(true);
		clearTimeout(goneTimer);
		goneTimer = setTimeout(() => (gone = true), SLIDE_MS);
		await tick();
		handle?.focus();
	}

	async function expand() {
		clearTimeout(goneTimer);
		// Put the rail back in the grid (still slid out), then slide it in on the next frames.
		gone = false;
		remember(false);
		await tick();
		requestAnimationFrame(() =>
			requestAnimationFrame(async () => {
				collapsed = false;
				await tick();
				collapseButton?.focus();
			})
		);
	}

	let { children }: { children: Snippet } = $props();

	const pathname = $derived(page.url.pathname);
	const locks = $derived(
		sitterLocks(
			page.data.displayRole === 'wall' ? sitter.session : null,
			sitter.now,
			page.data.adult === true
		)
	);
	const destinations = $derived(
		destinationsFor(page.data.todoLabel ?? TODO_FALLBACK).filter(
			(d) => !(locks.funHidden && isFunPath(d.href))
		)
	);
	// Games and Music are hidden for the session: a typed or swiped address goes home instead.
	$effect(() => {
		if (locks.funHidden && isFunPath(pathname)) void goto(resolve('/(app)'));
	});
	$effect(() => {
		if (!locks.sitterView) sitter.emergencyOpen = false;
		if (!locks.canApprove) sitter.approvalsOpen = false;
	});

	// The saved background choice comes with the page data; the settings page edits it optimistically.
	$effect(() => {
		wave.choice = parseWaveChoice(page.data.waveBackground);
	});

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
	<NightClock />
	<WakeGuard />
{/if}

<WaveBackground />
<TimerHost />

<div
	class:bg-surface={wave.choice === 'off'}
	data-collapsed={collapsed ? '' : undefined}
	data-gone={gone ? '' : undefined}
	class="shell grid h-full portrait:grid-cols-1 portrait:grid-rows-shell-portrait landscape:grid-cols-shell-landscape landscape:grid-rows-shell-landscape short:grid-cols-shell-short"
>
	<header
		inert={collapsed && sideRail}
		class="shell-header flex items-center justify-between gap-3 pt-safe-4 pr-safe-4 pb-4 pl-safe-4 max-sm:justify-end max-sm:pt-safe-2 max-sm:pr-safe-3 max-sm:pb-2 max-sm:pl-safe-3 sm:flex-wrap sm:gap-8 sm:pt-safe-8 sm:pr-safe-12 sm:pb-8 sm:pl-safe-12 portrait:sm:pr-safe-10 portrait:sm:pl-safe-10 landscape:col-start-2 landscape:row-start-1 landscape:pl-4 landscape:sm:gap-4 landscape:sm:pr-safe-8 landscape:sm:pl-8 short:flex-nowrap short:gap-1 short:pt-safe-2 short:pr-safe-2 short:pb-2 short:pl-2 tablet:flex-nowrap tablet:gap-4 tablet:pt-safe-2 tablet:pb-2 portrait:tablet:pr-safe-6 portrait:tablet:pl-safe-6 landscape:tablet:gap-4 landscape:tablet:pr-safe-6 landscape:tablet:pl-6"
	>
		<div class="flex min-w-0 items-center gap-4 landscape:flex-1 landscape:sm:min-w-min">
			{#if pathname === '/'}
				<span class="max-sm:hidden"></span>
			{:else}
				<div class="min-w-0 max-sm:hidden landscape:flex-1 landscape:sm:min-w-min">
					<a
						href={resolve('/(app)')}
						data-sveltekit-preload-data="tap"
						aria-label="Home"
						class="press-link block w-fit max-w-full min-w-0 rounded-control short:flex short:size-tap short:items-center short:justify-center short:rounded-chip short:border-2 short:border-line short:bg-surface-raised short:text-title short:text-ink short:shadow-raised"
					>
						<span class="short:hidden"><Clock testidPrefix="header-clock" /></span>
						<span class="hidden short:inline"><Icon name="home" /></span>
					</a>
				</div>
			{/if}
		</div>
		<div
			class="ml-auto flex items-center justify-end gap-2 sm:flex-wrap sm:gap-4 portrait:sm:gap-2 landscape:sm:gap-2 short:flex-nowrap short:gap-0.5 tablet:flex-nowrap tablet:gap-3 portrait:tablet:gap-3 landscape:tablet:gap-3"
		>
			{#if locks.sitterView}{@render emergencyButton()}{/if}
			{#if !(collapsed && sideRail)}<TimerPills />{/if}
			<OfflineBadge />
			{#if !locks.adultLocked}<ApprovalsBadge />{:else if locks.canApprove}
				<button
					type="button"
					onclick={() => (sitter.approvalsOpen = true)}
					data-testid="sitter-approvals-open"
					class="press-link inline-flex min-h-tap-kid shrink-0 items-center justify-center gap-2 rounded-chip bg-star px-6 text-body font-extrabold text-on-star shadow-raised max-sm:!min-h-tap short:!min-h-tap short:px-3 short:text-caption tablet:max-md:!min-h-tap"
				>
					Check jobs <span aria-hidden="true">⭐</span>
				</button>
			{/if}
			<button
				type="button"
				onclick={() => (timerState.panel = true)}
				aria-label="Timers"
				data-testid="timer-open"
				class="press-link inline-flex size-tap-kid shrink-0 items-center justify-center rounded-chip border-2 border-control-line bg-control text-title text-ink shadow-raised max-sm:hidden short:hidden tablet:hidden"
			>
				<Icon name="timer" />
			</button>
			<Button
				onclick={sleep}
				size="kid"
				class="gap-3 rounded-chip max-sm:!min-h-tap max-sm:!min-w-tap max-sm:!px-4 short:!min-h-tap short:!min-w-tap short:!px-0 tablet:!text-body tablet:max-xl:!px-0 tablet:max-md:!min-h-tap tablet:max-md:!min-w-tap tablet:md:!min-h-tap-tablet tablet:md:!min-w-tap-tablet tablet:xl:!px-6"
			>
				<span class="text-lead"><Icon name="moon" /></span>
				<span class="max-sm:sr-only short:sr-only tablet:max-xl:sr-only">Sleep</span>
			</Button>
			{#if adult}
				<Button
					onclick={lock}
					variant="secondary"
					size="kid"
					class="gap-3 rounded-chip max-sm:!min-h-tap max-sm:!min-w-tap max-sm:!px-0 short:!min-h-tap short:!min-w-tap short:!px-0 tablet:!px-0 tablet:!text-body tablet:max-md:!min-h-tap tablet:max-md:!min-w-tap tablet:md:!min-h-tap-tablet tablet:md:!min-w-tap-tablet"
				>
					<span class="text-lead"><Icon name="lock" /></span>
					<span class="max-sm:sr-only short:sr-only tablet:sr-only">Lock</span>
				</Button>
			{/if}
			<a
				href={resolve('/(app)/settings')}
				aria-label={locks.adultLocked ? 'Settings (locked while a sitter is here)' : 'Settings'}
				data-testid="settings-link"
				data-locked={locks.adultLocked ? '' : undefined}
				data-sveltekit-preload-data="tap"
				class="press-link inline-flex size-tap-kid items-center justify-center rounded-chip border-2 border-control-line bg-control text-title text-ink shadow-raised max-sm:!size-tap short:!size-tap tablet:text-lead tablet:max-md:!size-tap tablet:md:!size-tap-tablet"
			>
				<Icon name={locks.adultLocked ? 'lock' : 'settings'} />
			</a>
		</div>
	</header>

	<nav
		aria-label="Main"
		inert={collapsed && sideRail}
		class="shell-nav flex gap-2 border-line bg-surface-sunken p-4 max-sm:gap-1 max-sm:p-2 portrait:row-start-3 portrait:border-t-2 portrait:pt-4 portrait:pr-safe-4 portrait:pb-safe-4 portrait:pl-safe-4 portrait:max-sm:pt-2 portrait:max-sm:pr-safe-2 portrait:max-sm:pb-safe-2 portrait:max-sm:pl-safe-2 landscape:col-start-1 landscape:row-span-2 landscape:row-start-1 landscape:w-rail landscape:flex-col landscape:gap-3 landscape:border-r-2 landscape:pt-safe-8 landscape:pr-5 landscape:pb-safe-8 landscape:pl-safe-5 short:col-start-1 short:row-span-1 short:w-auto short:min-w-0 short:scrollbar-none short:flex-row short:gap-0 short:overflow-x-auto short:border-r-0 short:bg-surface short:pt-safe-2 short:pr-2 short:pb-2 short:pl-safe-2 portrait:tablet:gap-2 portrait:tablet:pt-1 portrait:tablet:pr-safe-4 portrait:tablet:pb-safe-1 portrait:tablet:pl-safe-4 landscape:tablet:w-rail-tablet landscape:tablet:gap-2 landscape:tablet:overflow-y-auto landscape:tablet:pt-safe-4 landscape:tablet:pr-2 landscape:tablet:pb-safe-4 landscape:tablet:pl-safe-2"
	>
		{#each destinations as destination (destination.id)}
			<NavItem {destination} active={isActive(destination.href, pathname)} />
		{/each}
		{#if locks.adultLocked}
			<p
				data-testid="sitter-lock-note"
				class="mt-auto flex items-center gap-2 rounded-control bg-surface-raised p-3 text-caption text-ink-muted max-sm:hidden portrait:hidden short:hidden"
			>
				<span class="text-body"><Icon name="lock" /></span>
				Settings and approvals are locked. A parent can unlock with their PIN.
			</p>
		{/if}
		<button
			bind:this={collapseButton}
			type="button"
			onclick={collapse}
			data-testid="nav-collapse"
			class="shell-collapse press-link mt-auto hidden min-h-tap-kid items-center justify-center gap-3 rounded-chip border-2 border-control-line bg-control px-4 text-body text-ink"
		>
			<span class="text-lead"><Icon name="collapse" /></span>
			<span class="tablet:sr-only">Hide menu</span>
		</button>
	</nav>

	{#if collapsed}
		<!-- Bottom-left (top-left while the photo overlay is up, since it owns the bottom edge): the calendar keeps its controls along the top and its day headers to the
		     right, photos keep their centre and top clear; the bottom-left of the calendar is only
		     the time gutter. The clock is non-interactive so it never swallows a tap. -->
		<div
			class="shell-float pointer-events-none fixed left-4 z-30 hidden items-center gap-3 {frameOverlay.any
				? 'top-4'
				: 'bottom-4'}"
		>
			<button
				bind:this={handle}
				type="button"
				onclick={expand}
				aria-label="Show menu"
				data-testid="nav-handle"
				class="press-link pointer-events-auto inline-flex size-tap-kid items-center justify-center rounded-chip border-2 border-on-frame/40 bg-scrim text-title text-on-frame"
			>
				<Icon name="menu" />
			</button>
			{#if locks.sitterView}<div class="pointer-events-auto">{@render emergencyButton()}</div>{/if}
			<div class="pointer-events-auto"><TimerPills /></div>
			{#if !frameOverlay.clock}
				<div
					class="rounded-chip bg-scrim px-4 py-2 text-on-frame"
					data-testid="corner-clock"
					aria-hidden="true"
				>
					<Clock testidPrefix="corner-clock" size="corner" />
				</div>
			{/if}
		</div>
	{/if}

	<!-- The page scrolls here; tabindex lets keyboard users scroll it even when it has no focusable content (axe scrollable-region-focusable). -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<main
		use:swipe={{ onswipe }}
		tabindex="0"
		class="shell-main min-h-0 touch-pan-y overflow-y-auto overscroll-contain portrait:row-start-2 landscape:col-start-2 landscape:row-start-2 landscape:pr-safe-0 landscape:pb-safe-0 short:col-span-2 short:col-start-1 short:border-t-2 short:border-line short:pl-safe-0"
	>
		{#key pathname}
			<div class="page-enter h-full">
				{@render children()}
			</div>
		{/key}
	</main>
</div>

{#if sitter.emergencyOpen && locks.sitterView}
	<SitterEmergency onclose={() => (sitter.emergencyOpen = false)} />
{/if}

{#if sitter.approvalsOpen && locks.canApprove}
	<SitterApprovals onclose={() => (sitter.approvalsOpen = false)} />
{/if}

{#snippet emergencyButton()}
	<!-- Always visible while a sitter session runs, on every page: one tap opens the Emergency info. -->
	<button
		type="button"
		onclick={() => (sitter.emergencyOpen = true)}
		data-testid="emergency-open"
		class="press-link inline-flex min-h-tap-kid shrink-0 items-center justify-center gap-3 rounded-chip bg-emergency px-6 text-body font-extrabold text-on-emergency shadow-raised max-sm:!min-h-tap short:!min-h-tap short:px-3 short:text-caption tablet:max-md:!min-h-tap"
	>
		<span aria-hidden="true">🚨</span>
		<span>Emergency info</span>
	</button>
{/snippet}

<style>
	/* Side-rail layouts only: landscape and not a short phone-sideways screen. */
	@media (orientation: landscape) and (min-height: 32.01rem) {
		.shell-collapse {
			display: inline-flex;
		}
		.shell-nav,
		.shell-header {
			transition:
				transform var(--duration-base) var(--ease-out-soft),
				opacity var(--duration-base) linear;
		}
		.shell[data-collapsed] .shell-nav {
			transform: translateX(-100%);
			opacity: 0;
			pointer-events: none;
		}
		.shell[data-collapsed] .shell-header {
			transform: translateY(-100%);
			opacity: 0;
			pointer-events: none;
		}
		/* Both bars have left the grid: the content owns the whole viewport. */
		.shell[data-gone] {
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: minmax(0, 1fr);
		}
		.shell[data-gone] .shell-nav,
		.shell[data-gone] .shell-header {
			display: none;
		}
		.shell[data-gone] .shell-main {
			grid-column-start: 1;
			grid-row-start: 1;
		}
		.shell-float {
			display: flex;
		}
	}
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
