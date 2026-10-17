<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { formatClock } from '#lib/domain/clock.js';
	import {
		morningRange,
		nextMorningLine,
		nightClockOffset,
		parseDisplayMode,
		type DisplayMode,
		type NightEvent
	} from '#lib/domain/night-clock.js';
	import { isTimeZone } from '#lib/domain/time-zone.js';

	/** Wall displays only (the shell mounts this for that role): a dim clock on a scheduled night (SLP-4). */
	const POLL_MS = 15_000;
	/** The first-event line refreshes this often (calendars sync on a slower cadence than this). */
	const EVENTS_MS = 5 * 60_000;

	let mode = $state<DisplayMode>('normal');
	let now = $state(Date.now());
	let wakeAt = $state<number | null>(null);
	let events = $state<NightEvent[]>([]);
	let polls = 0;

	async function poll() {
		const at = ++polls;
		try {
			const res = await fetch('/api/display/power', { cache: 'no-store' });
			if (res.ok && at === polls) {
				const body = await res.json();
				mode = parseDisplayMode(body.mode);
				const until = Date.parse(body.until);
				wakeAt = Number.isFinite(until) ? until : null;
			}
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

	// While the night clock shows, keep the morning's events fresh (one small request per 5 minutes).
	$effect(() => {
		const wake = wakeAt;
		const tz = zone;
		if (mode !== 'night-clock' || wake === null || !tz) return;
		const { start, end } = morningRange(wake, tz);
		let current = true;
		async function load() {
			try {
				const res = await fetch(`/api/calendar/events?start=${start}&end=${end}`);
				if (res.ok && current) events = await res.json();
			} catch {
				// Keep the last events; the next refresh corrects it.
			}
		}
		void load();
		const timer = setInterval(() => void load(), EVENTS_MS);
		return () => {
			current = false;
			clearInterval(timer);
		};
	});

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
	const morning = $derived(
		mode === 'night-clock' && wakeAt !== null && zone
			? nextMorningLine(events, wakeAt, now, zone)
			: null
	);
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
			{#if morning}
				<p class="morning truncate text-body text-night-clock-dim" data-testid="night-clock-event">
					{morning}
				</p>
			{/if}
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
	.morning {
		max-width: 80vw;
	}
	.clock-time {
		font-size: var(--text-night-clock);
	}
</style>
