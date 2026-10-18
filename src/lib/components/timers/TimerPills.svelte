<script lang="ts">
	import { formatRemaining, isFired, remainingMs, sortTimers } from '#lib/domain/timers.js';
	import { timerState } from './timers-state.svelte.js';

	const shown = $derived(
		sortTimers(timerState.list, timerState.now).filter((t) => !isFired(t, timerState.now))
	);
</script>

{#if shown.length > 0}
	<div
		class="flex min-w-0 scrollbar-none items-center gap-2 overflow-x-auto"
		data-testid="timer-pills"
	>
		{#each shown as t (t.id)}
			<button
				type="button"
				onclick={() => (timerState.panel = true)}
				data-testid="timer-pill"
				aria-label="{t.label ?? 'Timer'}, {formatRemaining(remainingMs(t, timerState.now))} left"
				class="press-link inline-flex min-h-tap shrink-0 items-center gap-2 rounded-chip border-2 border-line bg-accent-soft px-4 text-body font-extrabold text-ink tabular-nums"
			>
				{#if t.label}<span class="max-sm:hidden">{t.label}</span>{/if}
				<span class={t.endsAt === null ? 'text-ink-muted' : ''}>
					{formatRemaining(remainingMs(t, timerState.now))}
				</span>
			</button>
		{/each}
	</div>
{/if}

<style>
	.press-link {
		transition: transform var(--duration-quick) var(--ease-out-soft);
	}
	.press-link:active {
		transform: scale(0.95);
	}
</style>
