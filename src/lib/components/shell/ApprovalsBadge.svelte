<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { afterNavigate } from '$app/navigation';
	import { badgeLabel } from '#lib/domain/approvals.js';

	const REFRESH_MS = 60_000;
	let pending = $state(0);

	async function refresh() {
		try {
			const res = await fetch('/api/approvals/count');
			if (res.ok) pending = ((await res.json()) as { pending: number }).pending;
		} catch {
			// Offline blip: keep the last known count.
		}
	}

	onMount(() => {
		const timer = setInterval(() => void refresh(), REFRESH_MS);
		return () => clearInterval(timer);
	});
	afterNavigate(() => void refresh());
	const label = $derived(badgeLabel(pending));
</script>

{#if label}
	<a
		href={resolve('/(app)/settings/approvals')}
		data-testid="approvals-badge"
		data-sveltekit-preload-data="tap"
		class="press-link inline-flex min-h-tap-kid items-center rounded-chip bg-star px-4 text-caption font-extrabold whitespace-nowrap text-on-star shadow-raised max-sm:!min-h-tap sm:px-8 sm:text-body"
	>
		<span class="max-sm:hidden">{label}</span>
		<span class="sm:hidden" aria-label={label}>{pending} ⭐</span>
	</a>
{/if}

<style>
	.press-link {
		transition: transform var(--duration-quick) var(--ease-out-soft);
	}
	.press-link:active {
		transform: scale(0.95);
	}
	.press-link:focus-visible {
		outline: 4px solid var(--color-accent);
		outline-offset: 4px;
	}
</style>
