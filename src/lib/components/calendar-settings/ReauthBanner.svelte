<script lang="ts">
	import { resolve } from '$app/paths';
	import Button from '#lib/components/ui/Button.svelte';
	import { reconnectMessage } from '#lib/domain/calendar-health.js';

	interface Props {
		sources: { id: string; label: string }[];
		/** On the calendars page: reconnect in place. Elsewhere the button links there. */
		onreconnect?: (id: string) => void;
	}
	let { sources, onreconnect }: Props = $props();
</script>

{#if sources.length > 0}
	<ul class="flex flex-col gap-3" data-testid="reauth-banner">
		{#each sources as s (s.id)}
			<li
				class="flex flex-wrap items-center justify-between gap-4 rounded-card bg-star-soft p-6 text-ink"
			>
				<p class="text-body font-bold" role="status">
					<span aria-hidden="true">🔑</span>
					{reconnectMessage(s.label)}
				</p>
				{#if onreconnect}
					<Button onclick={() => onreconnect(s.id)}>Reconnect</Button>
				{:else}
					<a
						href="{resolve('/(app)/settings/calendars')}?reconnect={s.id}"
						class="inline-flex min-h-tap min-w-tap items-center justify-center rounded-control bg-accent px-8 text-body font-extrabold text-on-accent shadow-raised"
						>Reconnect</a
					>
				{/if}
			</li>
		{/each}
	</ul>
{/if}
