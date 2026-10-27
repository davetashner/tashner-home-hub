<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import { goalCaption } from '#lib/domain/savings-goals.js';
	import { formatMoney } from '#lib/domain/allowance.js';

	interface Goal {
		id: string;
		title: string;
		emoji: string | null;
		targetCents: number;
		savedCents: number;
		reached: boolean;
		current: boolean;
		status: 'active' | 'bought';
	}

	let {
		memberId,
		symbol,
		/** Balance in cents; a change (a purchase or a manual edit) reloads the goals. */
		balanceCents,
		onbought
	}: {
		memberId: string;
		symbol: string;
		balanceCents: number;
		/** Said after a purchase, with the kid's new balance. */
		onbought: (title: string, newBalanceCents: number) => void;
	} = $props();

	let goals = $state<Goal[]>([]);
	let error = $state('');
	let busy = $state('');

	async function load() {
		const res = await fetch(`/api/members/${memberId}/savings-goals`).catch(() => null);
		if (res?.ok) goals = ((await res.json()) as { goals: Goal[] }).goals;
	}

	onMount(() => void load());
	$effect(() => {
		void balanceCents;
		void load();
	});

	async function buy(g: Goal) {
		busy = g.id;
		error = '';
		const res = await fetch(`/api/members/${memberId}/savings-goals/${g.id}/bought`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{}'
		}).catch(() => null);
		busy = '';
		if (res?.ok) {
			const data = (await res.json()) as { balanceCents: number };
			onbought(g.title, data.balanceCents);
			await load();
		} else {
			error =
				res?.status === 409
					? `${g.title} is not fully saved up yet.`
					: "That didn't go through. Please try again.";
		}
	}
</script>

{#if goals.length > 0}
	<div class="flex flex-col gap-3" data-testid="savings-goals">
		<h3 class="text-body font-bold">Savings goals</h3>
		<ul class="flex flex-col gap-2">
			{#each goals as g (g.id)}
				<li
					class="flex flex-wrap items-center gap-3"
					data-testid="savings-goal"
					data-status={g.status}
					data-reached={g.reached}
				>
					<span aria-hidden="true">{g.emoji ?? '💰'}</span>
					<span class="flex min-w-40 flex-1 flex-col">
						<span class="text-body font-bold"
							>{g.title}{g.current && g.status === 'active' ? ' (in jar)' : ''}</span
						>
						<span class="text-caption text-ink-muted" data-testid="savings-goal-caption">
							{g.status === 'bought'
								? `Bought for ${formatMoney(g.targetCents, symbol)}`
								: goalCaption(g.savedCents, g.targetCents, symbol)}
						</span>
					</span>
					{#if g.status === 'active' && g.reached}
						<Button
							data-testid="savings-goal-bought"
							disabled={busy === g.id}
							onclick={() => void buy(g)}>Mark bought</Button
						>
					{/if}
				</li>
			{/each}
		</ul>
		{#if error}
			<p class="text-body text-danger" role="alert" data-testid="savings-goal-error">{error}</p>
		{/if}
	</div>
{/if}
