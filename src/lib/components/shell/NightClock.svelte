<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { formatClock } from '#lib/domain/clock.js';
	import { nightClockOffset, parseDisplayMode, type DisplayMode } from '#lib/domain/night-clock.js';
	import { isTimeZone } from '#lib/domain/time-zone.js';
	import { wave } from './wave-state.svelte.js';

	/** Wall displays only (the shell mounts this for that role): a dim clock on a scheduled night (SLP-4). */
	const POLL_MS = 15_000;

	let mode = $state<DisplayMode>('normal');
	let now = $state(Date.now());
	let polls = 0;

	// The wave background stops drawing while the screen is dimmed or off.
	$effect(() => {
		wave.paused = mode !== 'normal';
		return () => (wave.paused = false);
	});

	async function poll() {
		const at = ++polls;
		try {
			const res = await fetch('/api/display/power', { cache: 'no-store' });
			if (res.ok && at === polls) mode = parseDisplayMode((await res.json()).mode);
		} catch {
			// Keep the current mode; the next poll corrects it.
		}
	}

	function wake() {
		// Optimistic (touch to wake, SLP-3): the app shows now, the server starts the re-sleep timeout.
		polls++;
		mode = 'normal';
		void fetch('/api/display/wake', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{}'
		}).catch(() => {});
	}

	onMount(() => {
		void poll();
		const pollTimer = setInterval(() => void poll(), POLL_MS);
		const tick = setInterval(() => (now = Date.now()), 1000);
		return () => {
			clearInterval(pollTimer);
			clearInterval(tick);
		};
	});

	const zone = $derived(isTimeZone(page.data.timeZone) ? page.data.timeZone : undefined);
	const clock = $derived(formatClock(new Date(now), zone ? { timeZone: zone } : {}));
	const nudge = $derived(nightClockOffset(now));
</script>

{#if mode === 'night-clock'}
	<button
		type="button"
		aria-label="Wake display"
		data-testid="night-clock"
		onclick={wake}
		class="fixed inset-0 z-50 flex cursor-default items-center justify-center overflow-hidden bg-frame"
	>
		<div class="nudge flex flex-col items-center gap-4" style:--nx={nudge.x} style:--ny={nudge.y}>
			<p
				class="clock-time leading-none font-extrabold whitespace-nowrap text-night-clock tabular-nums"
				data-testid="night-clock-time"
			>
				{clock.time}
			</p>
			<p class="text-title text-night-clock-dim" data-testid="night-clock-date">{clock.date}</p>
		</div>
	</button>
{/if}

<style>
	/* Burn-in drift: only transform animates, one slow glide a minute. */
	.nudge {
		transform: translate(
			calc(var(--nx) * var(--spacing-night-nudge)),
			calc(var(--ny) * var(--spacing-night-nudge))
		);
		transition: transform 60s linear;
	}
	.clock-time {
		font-size: var(--text-night-clock);
	}
</style>
