<script lang="ts">
	import { onMount } from 'svelte';
	import PinPad, { type PinResult } from '#lib/components/PinPad.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import { formatMoney } from '#lib/domain/allowance.js';
	import { goalEffect, shopCard, type ShopReward } from '#lib/domain/reward-shop.js';

	interface Goal {
		id: string;
		title: string;
		cost: number;
	}
	interface Adult {
		id: string;
		name: string;
		role: string;
	}

	let {
		memberId,
		balance,
		goal,
		onclose,
		onchanged
	}: {
		memberId: string;
		balance: number;
		goal: Goal | null;
		onclose: () => void;
		/** Called after the goal or the balance changed on the server. */
		onchanged: () => void;
	} = $props();

	let rewards = $state<ShopReward[]>([]);
	let loaded = $state(false);
	let failed = $state(false);
	// Optimistic: the pick shows at once and rolls back if the server says no.
	let pickedId = $state<string | null | undefined>(undefined);
	let message = $state('');
	let buying = $state<ShopReward | null>(null);
	let askPin = $state(false);
	let adults = $state<Adult[]>([]);
	let adultId = $state<string | null>(null);
	// Read-only allowance (REW-7); shown only once the kid has some.
	let allowance = $state<{ balanceCents: number; symbol: string } | null>(null);

	const goalId = $derived(pickedId === undefined ? (goal?.id ?? null) : pickedId);
	const effect = $derived(buying ? goalEffect(balance, buying, goal) : null);

	onMount(() => {
		void fetch(`/api/members/${memberId}/allowance`).then(
			async (r) => {
				if (r.ok) allowance = (await r.json()) as { balanceCents: number; symbol: string };
			},
			() => {}
		);
		void loadShop();
	});

	async function loadShop() {
		try {
			const [r, m] = await Promise.all([fetch('/api/rewards'), fetch('/api/members')]);
			if (!r.ok) throw new Error(String(r.status));
			rewards = (await r.json()) as ShopReward[];
			if (m.ok) adults = ((await m.json()) as Adult[]).filter((a) => a.role === 'adult');
			if (adults.length === 1) adultId = adults[0].id;
		} catch {
			failed = true;
		} finally {
			loaded = true;
		}
	}

	const json = { 'content-type': 'application/json' };

	async function makeGoal(reward: ShopReward) {
		const before = pickedId;
		pickedId = reward.id;
		message = '';
		const ok = await fetch(`/api/members/${memberId}/goal`, {
			method: 'PUT',
			headers: json,
			body: JSON.stringify({ rewardId: reward.id })
		}).then(
			(r) => r.ok,
			() => false
		);
		if (ok) {
			message = `${reward.title} is your goal now!`;
			onchanged();
		} else {
			pickedId = before;
			message = 'Oops, that did not save. Try again!';
		}
	}

	/** The grown-up's PIN unlocks the existing redemption API; nothing else spends stars. */
	async function submitPin(pin: string): Promise<PinResult> {
		const reward = buying;
		if (!reward || !adultId) return { ok: false, message: 'Pick a grown-up first.' };
		const auth = await fetch('/api/auth/pin', {
			method: 'POST',
			headers: json,
			body: JSON.stringify({ memberId: adultId, pin, remember: false })
		});
		if (!auth.ok) {
			const body = (await auth.json().catch(() => ({}))) as {
				message?: string;
				retryAfterMs?: number;
			};
			return { ok: false, message: body.message ?? 'Wrong PIN.', retryAfterMs: body.retryAfterMs };
		}
		const res = await fetch('/api/redemptions', {
			method: 'POST',
			headers: json,
			body: JSON.stringify({ memberId, rewardId: reward.id })
		});
		if (!res.ok) return { ok: false, message: 'That did not go through. Try again!' };
		message = `Enjoy your ${reward.title}!`;
		buying = null;
		askPin = false;
		onchanged();
		return { ok: true };
	}

	function cancelBuy() {
		buying = null;
		askPin = false;
	}
</script>

<div class="fixed inset-0 z-20 flex items-end justify-center bg-ink/50 p-0 sm:items-center sm:p-8">
	<div
		role="dialog"
		aria-modal="true"
		aria-label="Reward shop"
		data-testid="reward-shop"
		class="sheet flex max-h-full w-full max-w-5xl flex-col gap-6 overflow-y-auto overscroll-contain rounded-t-sheet bg-surface-raised p-8 pb-safe-8 shadow-float sm:rounded-sheet"
	>
		<header class="flex items-center justify-between gap-6">
			<h2 class="text-title leading-none font-extrabold">Reward shop</h2>
			<Button variant="secondary" size="kid" data-testid="shop-close" onclick={onclose}>
				Close
			</Button>
		</header>
		<p class="text-lead font-extrabold text-ink-muted" data-testid="shop-balance">
			You have {balance}
			{balance === 1 ? 'star' : 'stars'}
		</p>
		{#if allowance && allowance.balanceCents > 0}
			<p class="text-lead font-extrabold text-ink-muted" data-testid="shop-allowance">
				Allowance {formatMoney(allowance.balanceCents, allowance.symbol)}
			</p>
		{/if}
		{#if message}
			<p role="status" data-testid="shop-message" class="text-lead font-bold">{message}</p>
		{/if}

		{#if buying}
			<section class="flex flex-col gap-6" data-testid="shop-confirm" aria-label="Get it now">
				<h3 class="text-title font-extrabold">
					<span aria-hidden="true">{buying.image ?? '🎁'}</span>
					Get {buying.title} for {buying.cost}
					{buying.cost === 1 ? 'star' : 'stars'}?
				</h3>
				<p class="text-lead" data-testid="shop-effect">
					{#if effect}
						{effect.text}.
					{:else}
						You will have {Math.max(0, balance - buying.cost)} stars left.
					{/if}
				</p>
				{#if !askPin}
					<div class="flex flex-wrap gap-4">
						<Button size="kid" data-testid="shop-confirm-yes" onclick={() => (askPin = true)}>
							Yes, ask a grown-up
						</Button>
						<Button variant="secondary" size="kid" onclick={cancelBuy}>Not now</Button>
					</div>
				{:else}
					<div class="flex flex-col items-center gap-6" data-testid="shop-pin">
						<p class="text-lead font-bold">Grown-up PIN, please</p>
						{#if adults.length > 1 && !adultId}
							<div class="flex flex-wrap justify-center gap-4">
								{#each adults as adult (adult.id)}
									<Button variant="secondary" size="kid" onclick={() => (adultId = adult.id)}>
										{adult.name}
									</Button>
								{/each}
							</div>
						{:else if adults.length === 0}
							<p class="text-body text-ink-muted">No grown-up PIN has been set up yet.</p>
						{:else}
							<PinPad onsubmit={submitPin} />
						{/if}
						<Button
							variant="secondary"
							size="kid"
							data-testid="shop-pin-cancel"
							onclick={cancelBuy}
						>
							Cancel
						</Button>
					</div>
				{/if}
			</section>
		{:else if !loaded}
			<p class="text-lead text-ink-muted" aria-busy="true">Loading...</p>
		{:else if failed}
			<p class="text-lead text-ink-muted">The shop could not open. Try again soon!</p>
		{:else if rewards.length === 0}
			<p class="text-lead text-ink-muted">No rewards yet. Ask a grown-up to add some!</p>
		{:else}
			<ul class="grid grid-cols-1 gap-6 landscape:grid-cols-2" data-testid="shop-list">
				{#each rewards as reward (reward.id)}
					{@const card = shopCard(reward, balance, goalId)}
					<li
						data-testid="shop-card"
						data-reward={reward.id}
						data-size={card.size}
						data-goal={card.isGoal}
						class="flex flex-col gap-4 rounded-card bg-surface-sunken p-6 {card.isGoal
							? 'ring-4 ring-ink'
							: ''}"
					>
						<div class="flex items-center gap-6">
							<span class="text-display leading-none" aria-hidden="true"
								>{reward.image ?? '🎁'}</span
							>
							<div class="flex min-w-0 flex-col gap-1">
								<p class="text-lead leading-tight font-extrabold">{reward.title}</p>
								<p class="text-body font-bold">{reward.cost} ⭐ · {card.size}</p>
								<p data-testid="shop-status" class="text-body font-bold text-ink-muted">
									{card.label}
								</p>
							</div>
						</div>
						<div class="flex flex-wrap gap-4">
							{#if card.isGoal}
								<p class="text-body font-extrabold" data-testid="shop-is-goal">Your goal</p>
							{:else}
								<Button
									size="kid"
									variant={card.canGetNow ? 'secondary' : 'primary'}
									data-testid="shop-make-goal"
									onclick={() => void makeGoal(reward)}
								>
									Make it my goal
								</Button>
							{/if}
							{#if card.canGetNow}
								<Button size="kid" data-testid="shop-get-now" onclick={() => (buying = reward)}>
									Get it now
								</Button>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>

<style>
	.sheet {
		animation: sheet-up var(--duration-base) var(--ease-out-soft) both;
	}
	@keyframes sheet-up {
		from {
			transform: translateY(2rem);
			opacity: 0;
		}
	}
</style>
