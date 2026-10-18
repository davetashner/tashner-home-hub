<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { installAudioUnlock, loadSoundSettings, playAlarm } from '#lib/components/kid/sound.js';
	import { setPowerMode } from '#lib/display/power-state.svelte.js';
	import Button from '#lib/components/ui/Button.svelte';
	import { doneMessage, firedTimers } from '#lib/domain/timers.js';
	import TimerPanel from './TimerPanel.svelte';
	import { removeTimer, timerState, useTimers } from './timers-state.svelte.js';

	/** The alarm repeats until every finished timer is dismissed. */
	const REPEAT_MS = 4000;

	const fired = $derived(firedTimers(timerState.list, timerState.now));
	const firedKey = $derived(fired.map((t) => t.id).join(','));
	let alarmed = '';

	onMount(() => {
		void loadSoundSettings();
		installAudioUnlock();
		return useTimers();
	});

	// A timer that just finished wakes a sleeping or dimmed wall, like a touch would (SLP-3).
	function wake() {
		if (page.data.displayRole !== 'wall') return;
		setPowerMode('normal');
		void fetch('/api/display/wake', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{}'
		}).catch(() => {});
	}

	$effect(() => {
		if (firedKey === '') {
			alarmed = '';
			return;
		}
		if (firedKey !== alarmed) {
			alarmed = firedKey;
			wake();
		}
		playAlarm();
		const again = setInterval(playAlarm, REPEAT_MS);
		return () => clearInterval(again);
	});
</script>

{#if timerState.panel}
	<TimerPanel onclose={() => (timerState.panel = false)} />
{/if}

{#if fired.length > 0}
	<div
		role="alert"
		data-testid="timer-banner"
		class="banner fixed inset-x-0 top-0 z-50 flex flex-col gap-2 bg-accent p-safe-4 text-on-accent shadow-float"
	>
		{#each fired as t (t.id)}
			<div class="flex items-center justify-between gap-4">
				<span class="min-w-0 text-headline leading-tight font-extrabold">{doneMessage(t)}</span>
				<Button
					variant="secondary"
					size="kid"
					onclick={() => removeTimer(t.id)}
					data-testid="timer-dismiss"
				>
					Dismiss
				</Button>
			</div>
		{/each}
	</div>
{/if}

<style>
	.banner {
		animation: drop var(--duration-base) var(--ease-out-soft) both;
	}
	@keyframes drop {
		from {
			opacity: 0;
			transform: translateY(-100%);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.banner {
			animation: none;
		}
	}
</style>
