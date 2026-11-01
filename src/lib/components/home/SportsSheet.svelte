<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import type { Game, SportsTeam } from '#lib/domain/sports.js';
	import { sheetDays, SHEET_DAYS, type ClashEvent } from '#lib/domain/sports-sheet.js';
	import { discClass } from '#lib/domain/team-colors.js';

	interface Props {
		games: Game[];
		teams: SportsTeam[];
		now: number;
		zone: string;
		onclose: () => void;
	}
	let { games, teams, now, zone, onclose }: Props = $props();

	let events = $state<ClashEvent[]>([]);
	let dialog = $state<HTMLElement>();
	const days = $derived(sheetDays(games, teams, events, now, zone));

	onMount(() => {
		dialog?.focus();
		// The clash notes are a bonus: the list shows at once and the notes follow if the calendar answers.
		const start = Date.now();
		const end = start + (SHEET_DAYS + 1) * 86_400_000;
		void (async () => {
			try {
				const res = await fetch(`/api/calendar/events?start=${start}&end=${end}`);
				if (res.ok) {
					const body = (await res.json()) as ClashEvent[];
					if (Array.isArray(body)) events = body;
				}
			} catch {
				// offline: no notes
			}
		})();
	});
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="fixed inset-0 z-50 flex items-end justify-center p-safe-8 landscape:items-center">
	<button type="button" aria-label="Close games" class="scrim absolute inset-0" onclick={onclose}
	></button>
	<div
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		bind:this={dialog}
		aria-labelledby="sports-sheet-title"
		data-testid="sports-sheet"
		class="sheet relative flex max-h-full w-full max-w-3xl flex-col gap-4 rounded-sheet bg-surface-raised p-8 text-ink shadow-float outline-none short:gap-2 short:p-4"
	>
		<div class="flex items-center justify-between gap-4">
			<h2 id="sports-sheet-title" class="text-headline leading-tight font-extrabold">
				Games, next two weeks
			</h2>
			<Button variant="secondary" onclick={onclose}>Close</Button>
		</div>
		<div class="flex min-h-0 flex-col gap-4 overflow-y-auto" data-testid="sports-sheet-list">
			{#each days as day (day.key)}
				<section data-testid="sports-day" aria-label={day.label} class="flex flex-col gap-2">
					<h3 class="text-caption font-black tracking-wide text-ink-muted uppercase">
						{day.label}
					</h3>
					{#each day.rows as r (r.key)}
						<div
							data-testid="sports-row"
							data-team={r.teamId}
							class="flex min-h-tap items-center gap-4 rounded-card border-2 border-line bg-surface px-4 py-2"
						>
							<span
								aria-hidden="true"
								class="grid size-14 flex-none place-items-center rounded-full text-caption font-black {discClass(
									r.teamId
								)}">{r.abbr}</span
							>
							<span class="flex min-w-0 flex-1 flex-col">
								<span class="truncate text-body font-black">{r.title}</span>
								{#if r.clash}
									<span data-testid="sports-clash" class="text-caption font-extrabold text-accent"
										>Same time as {r.clash}</span
									>
								{/if}
							</span>
							<span class="flex flex-none flex-col items-end text-right">
								{#if r.state === 'final'}
									<span data-testid="sports-row-when" class="text-body font-black tabular-nums">
										{r.outcome}
									</span>
								{:else if r.state === 'live'}
									<span
										data-testid="sports-row-when"
										class="flex items-center gap-2 text-body font-black text-danger tabular-nums"
									>
										{#if r.score}{r.score.team}–{r.score.opponent}{:else}Live{/if}
									</span>
									{#if r.status}
										<span class="text-caption font-bold text-ink-muted">{r.status}</span>
									{/if}
								{:else if r.state === 'postponed'}
									<span data-testid="sports-row-when" class="text-body font-black">Postponed</span>
								{:else}
									<span data-testid="sports-row-when" class="text-body font-black tabular-nums"
										>{r.time}</span
									>
									{#if r.channel}
										<span class="text-caption font-bold text-ink-muted">{r.channel}</span>
									{/if}
								{/if}
							</span>
						</div>
					{/each}
				</section>
			{:else}
				<p data-testid="sports-empty" class="py-8 text-center text-body text-ink-muted">
					No games in the next two weeks
				</p>
			{/each}
		</div>
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
