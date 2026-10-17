<script lang="ts">
	import { onMount } from 'svelte';
	import { parseDisplayMode } from '#lib/domain/night-clock.js';
	import { createWakeGuard } from '#lib/domain/wake-guard.js';

	/** Wall displays only (hub-xcr.7, SLP-3): swallow the tap that wakes the display. See wake-guard.ts. */
	const POLL_MS = 1000;
	const EVENTS = [
		'pointerdown',
		'pointerup',
		'mousedown',
		'mouseup',
		'touchstart',
		'touchend',
		'click'
	] as const;

	const guard = createWakeGuard();

	async function poll() {
		try {
			const res = await fetch('/api/display/power', { cache: 'no-store' });
			if (res.ok) guard.observe(parseDisplayMode((await res.json()).mode), Date.now());
		} catch {
			// Keep what is known; the next poll corrects it.
		}
	}

	function swallow(e: Event) {
		if (!guard.swallows(Date.now())) return;
		e.preventDefault();
		e.stopPropagation();
	}

	function resume() {
		if (document.visibilityState === 'hidden') return;
		guard.resume(Date.now());
		void poll();
	}

	onMount(() => {
		void poll();
		const timer = setInterval(() => void poll(), POLL_MS);
		for (const type of EVENTS)
			window.addEventListener(type, swallow, { capture: true, passive: false });
		document.addEventListener('visibilitychange', resume);
		window.addEventListener('pageshow', resume);
		return () => {
			clearInterval(timer);
			for (const type of EVENTS) window.removeEventListener(type, swallow, true);
			document.removeEventListener('visibilitychange', resume);
			window.removeEventListener('pageshow', resume);
		};
	});
</script>
