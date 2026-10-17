<script lang="ts">
	import { onMount } from 'svelte';
	import { powerState, usePowerState } from '#lib/display/power-state.svelte.js';
	import { createWakeGuard } from '#lib/domain/wake-guard.js';

	/** Wall displays only (hub-xcr.7, SLP-3): swallow the tap that wakes the display. See wake-guard.ts. */
	// Pointer events and the click that follows are enough: swallowing the click stops the press, and
	// no touch listener means no non-passive listener on the scroll path (tap latency).
	const EVENTS = ['pointerdown', 'pointerup', 'click'] as const;

	const guard = createWakeGuard();

	$effect(() => {
		guard.observe(powerState.mode, Date.now());
	});

	function swallow(e: Event) {
		if (!guard.swallows(Date.now())) return;
		e.preventDefault();
		e.stopPropagation();
	}

	function resume(e?: Event) {
		// A plain page load also fires pageshow; only a restore from the bfcache is a resume.
		if (document.visibilityState === 'hidden') return;
		if (e instanceof PageTransitionEvent && !e.persisted) return;
		guard.resume(Date.now());
	}

	onMount(() => {
		const release = usePowerState();
		for (const type of EVENTS) window.addEventListener(type, swallow, true);
		document.addEventListener('visibilitychange', resume);
		window.addEventListener('pageshow', resume);
		return () => {
			release();
			for (const type of EVENTS) window.removeEventListener(type, swallow, true);
			document.removeEventListener('visibilitychange', resume);
			window.removeEventListener('pageshow', resume);
		};
	});
</script>
