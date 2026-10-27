<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import MemberAvatar from '#lib/components/MemberAvatar.svelte';
	import AdultSavingsGoals from '#lib/components/AdultSavingsGoals.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import {
		DEFAULT_RATE,
		MAX_NOTE,
		formatMoney,
		maxCashout,
		parseMoney,
		parseRate,
		planAdjustment,
		planCashout,
		planPayout,
		type AllowanceRate
	} from '#lib/domain/allowance.js';
	import type { MemberColor } from '#lib/domain/member-colors.js';

	interface Kid {
		id: string;
		name: string;
		color: MemberColor;
		avatar: string | null;
		stars: number;
		balanceCents: number;
	}
	interface Entry {
		id: string;
		memberId: string;
		cents: number;
		kind: 'cashout' | 'payout' | 'adjustment';
		stars: number | null;
		note: string | null;
		createdAt: number;
	}
	type Mode = 'cashout' | 'payout' | 'adjust';

	let rate = $state<AllowanceRate>(DEFAULT_RATE);
	let kids = $state<Kid[]>([]);
	let history = $state<Entry[]>([]);
	let loaded = $state(false);
	let toast = $state('');
	let toastTimer: ReturnType<typeof setTimeout> | undefined;

	// Rate form
	let rateStars = $state('10');
	let rateMoney = $state('1.00');
	let rateSymbol = $state('$');
	let rateError = $state('');
	// Once the adult edits or saves the rate, a (late) load must not overwrite it.
	let rateTouched = false;

	// Per-kid action panel
	let open = $state<{ id: string; mode: Mode } | null>(null);
	let starsText = $state('');
	let moneyText = $state('');
	let note = $state('');
	let error = $state('');

	const names = $derived(Object.fromEntries(kids.map((k) => [k.id, k.name])));
	const json = { 'content-type': 'application/json' };
	const chip =
		'inline-flex min-h-tap min-w-tap items-center justify-center rounded-control border-2 px-6 text-body font-bold transition-transform duration-75 active:scale-95';
	const field =
		'min-h-tap w-full rounded-control border-2 border-line bg-surface px-6 text-body text-ink';

	function say(text: string) {
		toast = text;
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (toast = ''), 4000);
	}

	function applyRate(r: AllowanceRate) {
		rate = r;
		rateStars = String(r.stars);
		rateMoney = (r.cents / 100).toFixed(2);
		rateSymbol = r.symbol;
	}

	async function load() {
		const res = await fetch('/api/allowance').catch(() => null);
		if (res?.status === 401)
			// eslint-disable-next-line svelte/no-navigation-without-resolve
			await goto(`${resolve('/unlock')}?next=${encodeURIComponent('/settings/allowance')}`);
		if (!res?.ok) return;
		const data = (await res.json()) as { rate: AllowanceRate; members: Kid[]; history: Entry[] };
		if (!rateTouched) applyRate(data.rate);
		kids = data.members;
		history = data.history;
		loaded = true;
	}

	onMount(() => {
		void load().then(() => (loaded = true));
		return () => clearTimeout(toastTimer);
	});

	async function saveRate() {
		const next = parseRate({
			stars: Number(rateStars),
			cents: parseMoney(rateMoney),
			symbol: rateSymbol
		});
		if (!next.ok) {
			rateError = next.error;
			return;
		}
		rateError = '';
		rateTouched = true;
		const before = rate;
		rate = next.rate; // optimistic
		const res = await fetch('/api/allowance/rate', {
			method: 'PUT',
			headers: json,
			body: JSON.stringify(next.rate)
		}).catch(() => null);
		if (res?.ok) say('Rate saved.');
		else {
			applyRate(before);
			say("That didn't save. Please try again.");
		}
	}

	function toggle(kid: Kid, mode: Mode) {
		error = '';
		note = '';
		if (open?.id === kid.id && open.mode === mode) {
			open = null;
			return;
		}
		open = { id: kid.id, mode };
		starsText = mode === 'cashout' ? String(maxCashout(kid.stars, rate) || '') : '';
		moneyText = mode === 'payout' ? (kid.balanceCents / 100).toFixed(2) : '';
	}

	function plan(kid: Kid, mode: Mode) {
		if (mode === 'cashout') return planCashout(Number(starsText), kid.stars, rate);
		const cents = parseMoney(moneyText);
		if (mode === 'payout') return planPayout(cents, kid.balanceCents);
		return planAdjustment(cents, note);
	}

	/** Optimistic: the balances and history change at once; both are put back on failure. */
	async function submit(kid: Kid, mode: Mode) {
		const p = plan(kid, mode);
		if (!p.ok) {
			error = p.error;
			return;
		}
		error = '';
		const beforeKid = { stars: kid.stars, balanceCents: kid.balanceCents };
		const beforeHistory = history;
		const isCash = 'stars' in p;
		const cents = isCash ? p.cents : mode === 'payout' ? -p.cents : p.cents;
		const typed = (p as { note?: string }).note ?? '';
		kid.balanceCents += cents;
		if (isCash) kid.stars -= p.stars;
		history = [
			{
				id: `tmp-${Date.now()}`,
				memberId: kid.id,
				cents,
				kind: mode === 'adjust' ? 'adjustment' : mode,
				stars: isCash ? p.stars : null,
				note: typed || null,
				createdAt: Date.now()
			},
			...beforeHistory
		];
		open = null;
		const body = isCash
			? { memberId: kid.id, stars: p.stars }
			: { memberId: kid.id, cents: mode === 'payout' ? -cents : cents, note: typed };
		const res = await fetch(`/api/allowance/${mode === 'cashout' ? 'cashout' : mode}`, {
			method: 'POST',
			headers: json,
			body: JSON.stringify(body)
		}).catch(() => null);
		if (res?.ok) {
			say(
				mode === 'cashout'
					? `${kid.name} cashed out ${formatMoney(cents, rate.symbol)}.`
					: mode === 'payout'
						? `Paid ${kid.name} ${formatMoney(-cents, rate.symbol)}.`
						: `Adjusted ${kid.name}'s allowance.`
			);
		} else {
			kid.stars = beforeKid.stars;
			kid.balanceCents = beforeKid.balanceCents;
			history = beforeHistory;
			say("That didn't go through. Please try again.");
		}
		await load();
	}

	const when = (ms: number) =>
		new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
	const label = (e: Entry) =>
		e.kind === 'cashout' ? `Cashed out ${e.stars} ⭐` : e.kind === 'payout' ? 'Paid' : 'Adjustment';
</script>

<svelte:head><title>Allowance · Home Hub</title></svelte:head>

<section class="mx-auto flex w-full max-w-4xl flex-col gap-8 p-8 max-sm:p-3 short:gap-4 short:p-3">
	<h1 class="text-headline font-extrabold">Allowance</h1>

	<Card class="flex flex-col gap-4 !p-6 max-sm:!p-4">
		<h2 class="text-lead font-bold">Exchange rate</h2>
		<div class="flex flex-wrap items-end gap-4">
			<label class="flex w-32 flex-col gap-2">
				<span class="text-caption text-ink-muted">Stars</span>
				<input
					class={field}
					inputmode="numeric"
					bind:value={rateStars}
					oninput={() => (rateTouched = true)}
					data-testid="rate-stars"
				/>
			</label>
			<span class="pb-4 text-lead font-bold" aria-hidden="true">=</span>
			<label class="flex w-24 flex-col gap-2">
				<span class="text-caption text-ink-muted">Symbol</span>
				<input
					class={field}
					bind:value={rateSymbol}
					maxlength={3}
					oninput={() => (rateTouched = true)}
					data-testid="rate-symbol"
				/>
			</label>
			<label class="flex w-40 flex-col gap-2">
				<span class="text-caption text-ink-muted">Money</span>
				<input
					class={field}
					inputmode="decimal"
					bind:value={rateMoney}
					oninput={() => (rateTouched = true)}
					data-testid="rate-money"
				/>
			</label>
			<Button data-testid="rate-save" onclick={() => void saveRate()}>Save rate</Button>
		</div>
		{#if rateError}
			<p class="text-body text-danger" role="alert" data-testid="rate-error">{rateError}</p>
		{/if}
		<p class="text-body text-ink-muted" data-testid="rate-summary">
			{rate.stars}
			{rate.stars === 1 ? 'star' : 'stars'} = {formatMoney(rate.cents, rate.symbol)}
		</p>
	</Card>

	{#if toast}
		<p role="status" class="text-body font-bold" data-testid="allowance-toast">{toast}</p>
	{/if}

	{#if loaded && kids.length === 0}
		<p class="text-lead text-ink-muted" data-testid="allowance-empty">
			No children yet. Add your family in Settings, then Family.
		</p>
	{/if}

	<ul class="flex flex-col gap-4">
		{#each kids as kid (kid.id)}
			<li data-testid="allowance-kid" data-member={kid.id}>
				<Card class="flex flex-col gap-4 !p-6 max-sm:!p-4">
					<div class="flex flex-wrap items-center gap-4">
						<MemberAvatar name={kid.name} color={kid.color} avatar={kid.avatar} />
						<div class="flex min-w-40 flex-1 flex-col">
							<span class="text-lead font-bold">{kid.name}</span>
							<span class="text-caption text-ink-muted" data-testid="allowance-stars"
								>{kid.stars} ⭐ to spend</span
							>
						</div>
						<span class="text-headline font-extrabold" data-testid="allowance-balance">
							{formatMoney(kid.balanceCents, rate.symbol)}
						</span>
					</div>
					<div class="flex flex-wrap gap-3">
						{#each [['cashout', 'Cash out'], ['payout', 'Paid'], ['adjust', 'Adjust']] as const as [mode, text] (mode)}
							<button
								type="button"
								data-testid="allowance-{mode}"
								aria-pressed={open?.id === kid.id && open.mode === mode}
								onclick={() => toggle(kid, mode)}
								class="{chip} {open?.id === kid.id && open.mode === mode
									? 'border-accent bg-accent text-on-accent'
									: 'border-control-line bg-control'}">{text}</button
							>
						{/each}
					</div>
					<AdultSavingsGoals
						memberId={kid.id}
						symbol={rate.symbol}
						balanceCents={kid.balanceCents}
						onbought={(title, left) => {
							say(`Bought ${title}. ${kid.name} has ${formatMoney(left, rate.symbol)} left.`);
							void load();
						}}
					/>
					{#if open?.id === kid.id}
						{@const mode = open.mode}
						{@const p = plan(kid, mode)}
						<div class="flex flex-col gap-3" data-testid="allowance-panel">
							{#if mode === 'cashout'}
								<label class="flex flex-col gap-2">
									<span class="text-caption text-ink-muted">Stars to cash out</span>
									<input
										class={field}
										inputmode="numeric"
										bind:value={starsText}
										data-testid="allowance-stars-input"
									/>
								</label>
								<p class="text-body text-ink-muted" data-testid="allowance-preview">
									{p.ok ? `= ${formatMoney(p.cents, rate.symbol)}` : ''}
								</p>
							{:else}
								<label class="flex flex-col gap-2">
									<span class="text-caption text-ink-muted">
										{mode === 'payout' ? 'Amount handed over' : 'Amount (use - to take away)'}
									</span>
									<input
										class={field}
										inputmode="decimal"
										bind:value={moneyText}
										data-testid="allowance-money-input"
									/>
								</label>
								{#if mode === 'adjust'}
									<label class="flex flex-col gap-2">
										<span class="text-caption text-ink-muted">Why? (needed)</span>
										<input
											class={field}
											bind:value={note}
											maxlength={MAX_NOTE}
											data-testid="allowance-note"
										/>
									</label>
								{/if}
							{/if}
							{#if error}
								<p class="text-body text-danger" role="alert" data-testid="allowance-error">
									{error}
								</p>
							{/if}
							<div>
								<Button data-testid="allowance-confirm" onclick={() => void submit(kid, mode)}>
									{mode === 'cashout' ? 'Cash out' : mode === 'payout' ? 'Mark paid' : 'Save'}
								</Button>
							</div>
						</div>
					{/if}
				</Card>
			</li>
		{/each}
	</ul>

	<div class="flex flex-col gap-4">
		<h2 class="text-lead font-bold">History</h2>
		{#if loaded && history.length === 0}
			<p class="text-body text-ink-muted" data-testid="allowance-history-empty">
				Nothing yet. Cash-outs and payouts show up here.
			</p>
		{/if}
		<ul class="flex flex-col gap-3">
			{#each history as e (e.id)}
				<li data-testid="allowance-row" class="flex flex-wrap items-center gap-4">
					<span class="flex min-w-48 flex-1 flex-col">
						<span class="text-body font-bold">{names[e.memberId] ?? 'Someone'}: {label(e)}</span>
						<span class="text-caption text-ink-muted"
							>{when(e.createdAt)}{e.note ? ` · ${e.note}` : ''}</span
						>
					</span>
					<span class="text-body font-extrabold">
						{e.cents < 0 ? '−' : '+'}{formatMoney(Math.abs(e.cents), rate.symbol)}
					</span>
				</li>
			{/each}
		</ul>
	</div>
</section>
