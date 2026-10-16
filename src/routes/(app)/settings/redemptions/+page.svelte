<script lang="ts">
	import { onMount } from 'svelte';
	import Card from '#lib/components/ui/Card.svelte';

	interface Entry {
		id: string;
		memberName: string;
		rewardTitle: string;
		rewardImage: string | null;
		stars: number;
		approvedByName: string | null;
		createdAt: number;
	}

	let entries = $state<Entry[]>([]);
	let loaded = $state(false);
	let failed = $state(false);

	onMount(async () => {
		const res = await fetch('/api/redemptions?limit=200').catch(() => null);
		if (res?.ok) entries = await res.json();
		else failed = true;
		loaded = true;
	});

	const when = (ms: number) =>
		new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
</script>

<svelte:head><title>Redemption log · Home Hub</title></svelte:head>

<section class="mx-auto flex w-full max-w-4xl flex-col gap-8 p-8 portrait:max-sm:p-4">
	<h1 class="text-headline font-extrabold">Redemption log</h1>

	{#if failed}
		<p class="text-lead text-danger" role="alert">Couldn't load the log. Please try again.</p>
	{:else if loaded && entries.length === 0}
		<p class="text-lead text-ink-muted" data-testid="redemptions-empty">
			Nothing redeemed yet. Rewards show up here once a grown-up redeems them.
		</p>
	{/if}

	<ul class="flex flex-col gap-4">
		{#each entries as e (e.id)}
			<li data-testid="redemption-row">
				<Card class="flex flex-wrap items-center gap-6 !p-6">
					<span class="w-16 text-center text-headline" aria-hidden="true">
						{e.rewardImage ?? '🎁'}
					</span>
					<span class="flex min-w-48 flex-1 flex-col">
						<span class="text-lead font-bold">{e.memberName}: {e.rewardTitle}</span>
						<span class="text-caption text-ink-muted">
							{when(e.createdAt)}{e.approvedByName ? ` · by ${e.approvedByName}` : ''}
						</span>
					</span>
					<span class="text-lead font-extrabold">−{e.stars} ⭐</span>
				</Card>
			</li>
		{/each}
	</ul>
</section>
