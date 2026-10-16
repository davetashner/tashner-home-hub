<script lang="ts">
	import MemberAvatar from '#lib/components/MemberAvatar.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import { rangeLabel, stripeColor } from '#lib/domain/calendar-view/format.js';
	import type { CalEvent } from '#lib/domain/calendar-view/layout.js';
	import type { MemberColor } from '#lib/domain/member-colors.js';

	interface Props {
		event: CalEvent;
		tz: string;
		onclose: () => void;
	}
	let { event, tz, onclose }: Props = $props();
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="fixed inset-0 z-50 flex items-end justify-center p-8 landscape:items-center">
	<button type="button" aria-label="Close details" class="scrim absolute inset-0" onclick={onclose}
	></button>
	<div
		role="dialog"
		aria-modal="true"
		aria-labelledby="event-title"
		class="sheet relative flex max-h-full w-full max-w-4xl flex-col gap-6 overflow-y-auto rounded-sheet bg-surface-raised p-10 shadow-float"
	>
		<div class="flex items-start gap-6">
			<span class="stripe" style="background: {stripeColor(event.members)}" aria-hidden="true"
			></span>
			<div class="min-w-0 flex-1">
				<h2 id="event-title" class="text-headline leading-tight font-extrabold">{event.title}</h2>
				<p class="mt-2 text-lead text-ink-muted">{rangeLabel(event, tz)}</p>
			</div>
		</div>
		{#if event.members.length}
			<ul class="flex flex-wrap gap-4">
				{#each event.members as m (m.id)}
					<li class="flex items-center gap-3 rounded-chip bg-surface-sunken py-2 pr-6 pl-2">
						<MemberAvatar name={m.name} color={m.color as MemberColor} size="sm" />
						<span class="text-body font-extrabold">{m.name}</span>
					</li>
				{/each}
			</ul>
		{/if}
		{#if event.location}
			<p class="text-lead"><span class="text-ink-muted">Where</span> &nbsp;{event.location}</p>
		{/if}
		{#if event.notes}
			<p class="text-body whitespace-pre-line text-ink-muted">{event.notes}</p>
		{/if}
		<Button onclick={onclose} variant="secondary" class="self-end">Close</Button>
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
	.stripe {
		align-self: stretch;
		width: 0.75rem;
		flex: none;
		border-radius: var(--radius-chip);
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
