<script lang="ts">
	import Button from '#lib/components/ui/Button.svelte';
	import {
		formatRemaining,
		isFired,
		isRunning,
		MAX_TIMERS,
		MAX_TIMER_MS,
		MINUTE_MS,
		remainingMs,
		sortTimers,
		TIMER_LABELS,
		TIMER_PRESET_MINUTES
	} from '#lib/domain/timers.js';
	import {
		changeTimer,
		removeTimer,
		startKitchenTimer,
		timerState
	} from './timers-state.svelte.js';

	let { onclose }: { onclose: () => void } = $props();

	let minutes = $state(0);
	let label = $state<string | null>(null);

	const timers = $derived(sortTimers(timerState.list, timerState.now));
	const full = $derived(timers.length >= MAX_TIMERS);

	const add = (m: number) => (minutes = Math.min(MAX_TIMER_MS / MINUTE_MS, minutes + m));

	function start() {
		if (minutes < 1 || full) return;
		startKitchenTimer(minutes * MINUTE_MS, label);
		minutes = 0;
		label = null;
	}

	const chip =
		'press inline-flex min-h-tap items-center justify-center rounded-chip border-2 px-6 text-body font-extrabold';
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="fixed inset-0 z-50 flex items-center justify-center p-safe-4">
	<button type="button" aria-label="Close timers" class="scrim absolute inset-0" onclick={onclose}
	></button>
	<div
		role="dialog"
		aria-modal="true"
		aria-labelledby="timer-title"
		data-testid="timer-panel"
		class="sheet relative flex max-h-full w-full max-w-4xl flex-col gap-6 overflow-y-auto rounded-sheet bg-surface-raised p-8 text-ink shadow-float short:gap-3 short:p-4"
	>
		<div class="flex items-center justify-between gap-4">
			<h2 id="timer-title" class="text-headline leading-tight font-extrabold">Timers</h2>
			<Button variant="secondary" onclick={onclose} data-testid="timer-close">Done</Button>
		</div>

		{#if timers.length > 0}
			<ul class="flex flex-col gap-3" data-testid="timer-list">
				{#each timers as t (t.id)}
					<li
						class="flex flex-wrap items-center gap-3 rounded-card bg-surface-sunken p-4"
						data-testid="timer-row"
					>
						<span class="min-w-0 flex-1 text-body font-extrabold">
							{t.label ?? 'Timer'}
							<span class="ml-3 tabular-nums" data-testid="timer-row-time">
								{isFired(t, timerState.now)
									? 'Done'
									: formatRemaining(remainingMs(t, timerState.now))}
							</span>
							{#if !isRunning(t)}<span class="ml-2 text-caption text-ink-muted">Paused</span>{/if}
						</span>
						{#if isFired(t, timerState.now)}
							<Button onclick={() => removeTimer(t.id)}>Dismiss</Button>
						{:else}
							<Button
								variant="secondary"
								onclick={() => changeTimer(t.id, isRunning(t) ? 'pause' : 'resume')}
								data-testid="timer-pause"
							>
								{isRunning(t) ? 'Pause' : 'Resume'}
							</Button>
							<Button variant="secondary" onclick={() => changeTimer(t.id, 'add', MINUTE_MS)}>
								+1 min
							</Button>
							<Button variant="danger" onclick={() => removeTimer(t.id)} data-testid="timer-cancel">
								Cancel
							</Button>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}

		<section class="flex flex-col gap-4" aria-label="New timer">
			<div class="flex flex-wrap items-center gap-3" role="group" aria-label="Minutes">
				{#each TIMER_PRESET_MINUTES as m (m)}
					<button
						type="button"
						class="{chip} border-line bg-surface text-ink"
						data-testid="timer-preset-{m}"
						onclick={() => (minutes = m)}
					>
						{m} min
					</button>
				{/each}
				<button type="button" class="{chip} border-line bg-surface text-ink" onclick={() => add(1)}>
					+1
				</button>
				<button type="button" class="{chip} border-line bg-surface text-ink" onclick={() => add(5)}>
					+5
				</button>
			</div>
			<div class="flex flex-wrap items-center gap-3" role="group" aria-label="Label">
				{#each TIMER_LABELS as l (l)}
					<button
						type="button"
						class="{chip} {label === l
							? 'border-accent bg-accent-soft text-ink'
							: 'border-line bg-surface text-ink'}"
						aria-pressed={label === l}
						onclick={() => (label = label === l ? null : l)}
					>
						{l}
					</button>
				{/each}
			</div>
			<div class="flex items-center justify-between gap-4">
				<span class="text-title font-extrabold tabular-nums" data-testid="timer-pending">
					{minutes > 0 ? `${minutes} min` : 'Pick a time'}
				</span>
				<Button onclick={start} disabled={minutes < 1 || full} data-testid="timer-start">
					Start timer
				</Button>
			</div>
		</section>
	</div>
</div>

<style>
	.scrim {
		background: color-mix(in oklch, var(--color-ink) 45%, transparent);
		animation: fade var(--duration-base) linear both;
	}
	.sheet {
		animation: rise var(--duration-base) var(--ease-out-soft) both;
	}
	.press {
		transition: transform var(--duration-quick) var(--ease-out-soft);
		cursor: pointer;
	}
	.press:active {
		transform: scale(0.95);
	}
	@keyframes fade {
		from {
			opacity: 0;
		}
	}
	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(2rem);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.scrim,
		.sheet {
			animation: none;
		}
	}
</style>
