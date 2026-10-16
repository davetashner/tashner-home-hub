<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import {
		createIdleTimer,
		DEFAULT_IDLE,
		IDLE_SETTINGS_EVENT,
		parseIdleSettings,
		type IdleSettings,
		type IdleTimer
	} from '#lib/domain/idle.js';
	import { DESTINATION_URLS } from './urls.js';

	/** Ignore the click that follows the touch waking the photo frame, so it doesn't press anything. */
	const WAKE_CLICK_MS = 1000;

	let timer: IdleTimer | null = null;
	let previous = '';
	let wokeAt = -Infinity;

	const isBusy = () => {
		const el = document.activeElement;
		return (
			el instanceof HTMLElement &&
			(el.isContentEditable ||
				el.matches('input:not([type=button]):not([type=checkbox]), textarea, select'))
		);
	};

	function start(settings: IdleSettings) {
		timer?.stop();
		timer = createIdleTimer(settings, {
			setTimeout: (fn, ms) => window.setTimeout(fn, ms),
			clearTimeout: (h) => window.clearTimeout(h as number),
			isBusy,
			goHome: () => {
				if (page.url.pathname !== '/') void goto(resolve('/(app)'));
			},
			startFrame: () => {
				previous = page.url.pathname + page.url.search;
				// URL already built with resolve() in urls.ts.
				// eslint-disable-next-line svelte/no-navigation-without-resolve
				void goto(DESTINATION_URLS['/photos']);
			},
			endFrame: () => {
				// `previous` is a same-origin app path captured from page.url.
				// eslint-disable-next-line svelte/no-navigation-without-resolve
				if (previous) void goto(previous);
			}
		});
	}

	function onactivity(e: Event) {
		if (timer?.phase === 'frame' && e.type === 'pointerdown') wokeAt = e.timeStamp;
		timer?.activity();
	}

	function onclick(e: MouseEvent) {
		if (e.timeStamp - wokeAt < WAKE_CLICK_MS) {
			e.preventDefault();
			e.stopPropagation();
		}
	}

	function onsettings(e: Event) {
		start(parseIdleSettings((e as CustomEvent<Record<string, unknown>>).detail));
	}

	onMount(() => {
		start(DEFAULT_IDLE);
		void fetch('/api/settings/idle')
			.then((r) => (r.ok ? r.json() : null))
			.then((s: Record<string, unknown> | null) => {
				if (s && timer) start(parseIdleSettings(s));
			})
			.catch(() => {});
		window.addEventListener(IDLE_SETTINGS_EVENT, onsettings);
		return () => {
			window.removeEventListener(IDLE_SETTINGS_EVENT, onsettings);
			timer?.stop();
			timer = null;
		};
	});
</script>

<svelte:window
	onpointerdowncapture={onactivity}
	onkeydowncapture={onactivity}
	onwheelcapture={onactivity}
	onclickcapture={onclick}
/>
