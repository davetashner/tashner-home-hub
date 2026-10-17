<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { afterNavigate } from '$app/navigation';
	import {
		ATTENTION_CHANGED_EVENT,
		attentionLabel,
		badgeLabel,
		compactCount
	} from '#lib/domain/approvals.js';

	const REFRESH_MS = 60_000;
	let total = $state(0);

	async function refresh() {
		try {
			const res = await fetch('/api/approvals/count');
			if (res.ok) total = ((await res.json()) as { total: number }).total;
		} catch {
			// Offline blip: keep the last known count.
		}
	}

	onMount(() => {
		const timer = setInterval(() => void refresh(), REFRESH_MS);
		const onChanged = () => void refresh();
		window.addEventListener(ATTENTION_CHANGED_EVENT, onChanged);
		return () => {
			clearInterval(timer);
			window.removeEventListener(ATTENTION_CHANGED_EVENT, onChanged);
		};
	});
	afterNavigate(() => void refresh());
	const label = $derived(badgeLabel(total));
	const compact = $derived(compactCount(total));
	const spoken = $derived(attentionLabel(total));
</script>

{#if label}
	<a
		href={resolve('/(app)/settings/approvals')}
		data-testid="approvals-badge"
		data-count={total}
		aria-label={spoken}
		data-sveltekit-preload-data="tap"
		class="press-link inline-flex min-h-tap-kid items-center rounded-chip bg-star px-4 text-caption font-extrabold whitespace-nowrap text-on-star shadow-raised max-sm:!min-h-tap sm:px-8 sm:text-body short:!min-h-tap short:min-w-tap short:justify-center short:px-2 short:text-caption tablet:px-4 tablet:text-body tablet:max-md:!min-h-tap tablet:md:!min-h-tap-tablet tablet:lg:px-6"
	>
		<span class="max-sm:hidden short:hidden tablet:max-lg:hidden">{label}</span>
		<!-- Short landscape phones drop the star: the yellow chip alone reads as "to check". -->
		<span class="sm:hidden short:inline tablet:max-lg:!inline"
			>{compact}<span class="ml-1 short:hidden">⭐</span></span
		>
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
