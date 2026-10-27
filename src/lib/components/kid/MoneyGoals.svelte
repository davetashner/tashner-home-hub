<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import { REWARD_EMOJI } from '#lib/domain/emoji.js';
	import { formatMoney } from '#lib/domain/allowance.js';
	import {
		GOAL_DEFAULT_CENTS,
		GOAL_TITLE_MAX,
		bumpGoalCents,
		goalCaption,
		goalPercent,
		moneyReachedKey
	} from '#lib/domain/savings-goals.js';
	import { celebrateAllDone } from './celebrate.js';

	interface MoneyGoal {
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
		onmessage
	}: {
		memberId: string;
		/** Short status line the sheet shows above the tabs. */
		onmessage: (text: string) => void;
	} = $props();

	const json = { 'content-type': 'application/json' };
	const base = $derived(`/api/members/${memberId}/savings-goals`);
	let goals = $state<MoneyGoal[]>([]);
	let symbol = $state('$');
	let loaded = $state(false);
	let adding = $state(false);
	let title = $state('');
	let emoji = $state('');
	let cents = $state(GOAL_DEFAULT_CENTS);
	// Fallback when localStorage is unavailable: the party still happens once per open sheet.
	const thrown: string[] = [];

	onMount(() => void load());

	function alreadyThrown(id: string): boolean {
		if (thrown.includes(id)) return true;
		try {
			return localStorage.getItem(moneyReachedKey(id)) === '1';
		} catch {
			return false;
		}
	}
	function markThrown(id: string) {
		thrown.push(id);
		try {
			localStorage.setItem(moneyReachedKey(id), '1');
		} catch {
			// private mode: the in-memory set still keeps it to once per open
		}
	}

	async function load() {
		try {
			const r = await fetch(base);
			if (r.ok) {
				const data = (await r.json()) as { symbol?: string; goals: MoneyGoal[] };
				goals = data.goals;
				symbol = data.symbol ?? '$';
				const fresh = goals.find((g) => g.status === 'active' && g.reached && !alreadyThrown(g.id));
				if (fresh) {
					markThrown(fresh.id);
					onmessage(`You saved enough for ${fresh.title}!`);
					celebrateAllDone();
				}
			} else onmessage('Your money goals could not load. Try again soon!');
		} catch {
			onmessage('Your money goals could not load. Try again soon!');
		}
		loaded = true;
	}

	async function pick(g: MoneyGoal) {
		const before = goals;
		goals = goals.map((x) => ({ ...x, current: x.id === g.id }));
		const ok = await fetch(`${base}/${g.id}/current`, {
			method: 'PUT',
			headers: json,
			body: '{}'
		}).then(
			(r) => r.ok,
			() => false
		);
		if (ok) onmessage(`${g.title} is your money goal now!`);
		else {
			goals = before;
			onmessage('Oops, that did not save. Try again!');
		}
	}

	async function remove(g: MoneyGoal) {
		const before = goals;
		goals = goals.filter((x) => x.id !== g.id);
		const ok = await fetch(`${base}/${g.id}`, {
			method: 'DELETE',
			headers: json,
			body: '{}'
		}).then(
			(r) => r.ok,
			() => false
		);
		if (ok) await load();
		else {
			goals = before;
			onmessage('Oops, that did not remove. Try again!');
		}
	}

	async function add(e: SubmitEvent) {
		e.preventDefault();
		const name = title.trim();
		if (!name) {
			onmessage('Give your goal a name!');
			return;
		}
		const res = await fetch(base, {
			method: 'POST',
			headers: json,
			body: JSON.stringify({ title: name, targetCents: cents, emoji: emoji || undefined })
		}).catch(() => null);
		if (!res?.ok) {
			onmessage('Oops, that did not save. Try again!');
			return;
		}
		onmessage(`${name} is on your list!`);
		adding = false;
		title = '';
		emoji = '';
		cents = GOAL_DEFAULT_CENTS;
		await load();
	}

	const bump = (dollars: number) => (cents = bumpGoalCents(cents, dollars));
	const steps = [-10, -1, 1, 10];
</script>

{#if adding}
	<form class="flex flex-col gap-6" data-testid="money-form" onsubmit={add}>
		<label class="flex flex-col gap-2">
			<span class="text-caption text-ink-muted">What are you saving for?</span>
			<input
				class="min-h-tap-kid w-full rounded-control border-2 border-line bg-surface px-6 text-lead text-ink"
				bind:value={title}
				maxlength={GOAL_TITLE_MAX}
				data-testid="money-title"
			/>
		</label>
		<div class="flex flex-col gap-2">
			<span class="text-caption text-ink-muted" id="money-emoji-label">Pick a picture</span>
			<div
				class="flex flex-wrap gap-2"
				role="group"
				aria-labelledby="money-emoji-label"
				data-testid="money-emoji-grid"
			>
				{#each REWARD_EMOJI as c (c.emoji)}
					<button
						type="button"
						class="flex size-tap-kid items-center justify-center rounded-control border-2 text-title active:scale-95 {emoji ===
						c.emoji
							? 'border-accent bg-accent-soft'
							: 'border-line bg-surface'}"
						aria-label={c.label}
						aria-pressed={emoji === c.emoji}
						data-testid="money-emoji"
						onclick={() => (emoji = emoji === c.emoji ? '' : c.emoji)}
					>
						{c.emoji}
					</button>
				{/each}
			</div>
		</div>
		<div class="flex flex-col gap-2">
			<span class="text-caption text-ink-muted">How much does it cost?</span>
			<div class="flex items-center justify-center gap-2 sm:gap-4">
				{#each steps.slice(0, 2) as d (d)}
					<Button
						variant="secondary"
						size="kid"
						class="px-2!"
						aria-label="{Math.abs(d)} dollars less"
						data-testid="money-step"
						onclick={() => bump(d)}>-{symbol}{Math.abs(d)}</Button
					>
				{/each}
				<p class="min-w-24 text-center text-title font-extrabold" data-testid="money-cost">
					{formatMoney(cents, symbol)}
				</p>
				{#each steps.slice(2) as d (d)}
					<Button
						variant="secondary"
						size="kid"
						class="px-2!"
						aria-label="{d} dollars more"
						data-testid="money-step"
						onclick={() => bump(d)}>+{symbol}{d}</Button
					>
				{/each}
			</div>
		</div>
		<div class="flex flex-wrap gap-4">
			<Button type="submit" size="kid" class="px-2!" data-testid="money-save">Save goal</Button>
			<Button variant="secondary" size="kid" onclick={() => (adding = false)}>Not now</Button>
		</div>
	</form>
{:else}
	{#if !loaded}
		<p class="text-lead text-ink-muted" aria-busy="true">Loading...</p>
	{:else if goals.length === 0}
		<p class="text-lead text-ink-muted" data-testid="money-empty">
			No money goals yet. What will you save up for?
		</p>
	{:else}
		<ul class="grid grid-cols-1 gap-6 landscape:grid-cols-2" data-testid="money-list">
			{#each goals as g (g.id)}
				<li
					data-testid="money-card"
					data-current={g.current}
					data-reached={g.reached}
					data-status={g.status}
					class="flex flex-col gap-4 rounded-card bg-surface-sunken p-6 {g.current &&
					g.status === 'active'
						? 'ring-4 ring-ink'
						: ''}"
				>
					<div class="flex items-center gap-6">
						<span class="text-display leading-none" aria-hidden="true">{g.emoji ?? '💰'}</span>
						<div class="flex min-w-0 flex-col gap-1">
							<p class="text-lead leading-tight font-extrabold">{g.title}</p>
							<p class="text-body font-bold text-ink-muted" data-testid="money-caption">
								{goalCaption(g.savedCents, g.targetCents, symbol)}
							</p>
						</div>
					</div>
					<div
						class="h-6 overflow-hidden rounded-full bg-line"
						role="progressbar"
						aria-label="Saved so far"
						aria-valuemin="0"
						aria-valuemax="100"
						aria-valuenow={goalPercent(g.savedCents, g.targetCents)}
					>
						<div
							class="fill h-full w-full origin-left rounded-full bg-star"
							data-testid="money-fill"
							style:transform="scaleX({goalPercent(g.savedCents, g.targetCents) / 100})"
						></div>
					</div>
					{#if g.status === 'bought'}
						<p class="text-body font-extrabold" data-testid="money-bought">You bought it!</p>
					{:else}
						{#if g.reached}
							<p class="text-body font-extrabold" data-testid="money-reached">
								You saved enough! Ask a grown-up to buy it.
							</p>
						{/if}
						<div class="flex flex-wrap gap-4">
							{#if g.current}
								<p class="self-center text-body font-extrabold" data-testid="money-is-current">
									In my jar now
								</p>
							{:else}
								<Button size="kid" data-testid="money-pick" onclick={() => void pick(g)}>
									Show in my jar
								</Button>
							{/if}
							<Button
								variant="secondary"
								size="kid"
								data-testid="money-remove"
								aria-label="Remove {g.title}"
								onclick={() => void remove(g)}>Remove</Button
							>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
	<div>
		<Button size="kid" data-testid="money-new" onclick={() => (adding = true)}>
			Make a new money goal
		</Button>
	</div>
{/if}

<style>
	.fill {
		transition: transform var(--duration-base) var(--ease-out-soft);
	}
</style>
