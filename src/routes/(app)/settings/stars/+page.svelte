<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import MemberAvatar from '#lib/components/MemberAvatar.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import {
		GIVE_AMOUNTS,
		MAX_NOTE,
		QUICK_REASONS,
		REMOVE_AMOUNTS,
		actionLabel,
		activityRows,
		activityTitle,
		planAdjustment,
		type LedgerRow
	} from '#lib/domain/bonus.js';
	import type { MemberColor } from '#lib/domain/member-colors.js';

	interface Child {
		id: string;
		name: string;
		role: string;
		color: MemberColor;
		avatar: string | null;
	}

	const AMOUNTS = [...GIVE_AMOUNTS, ...REMOVE_AMOUNTS.map((n) => -n)];
	let children = $state<Child[]>([]);
	let selectedId = $state<string | null>(null);
	let balances = $state<Record<string, number>>({});
	let rows = $state<Record<string, LedgerRow[]>>({});
	let loaded = $state(false);
	let delta = $state(0);
	let note = $state('');
	let toast = $state('');
	let error = $state('');
	let toastTimer: ReturnType<typeof setTimeout> | undefined;

	const selected = $derived(children.find((c) => c.id === selectedId) ?? null);
	const balance = $derived(selectedId ? (balances[selectedId] ?? 0) : 0);
	const plan = $derived(planAdjustment({ delta: delta || null, note, balance }));
	const activity = $derived(selectedId ? activityRows(rows[selectedId] ?? []) : []);
	const chip =
		'inline-flex min-h-tap min-w-tap items-center justify-center rounded-control border-2 px-6 text-body font-bold transition-transform duration-75 active:scale-95';
	const field =
		'min-h-tap w-full rounded-control border-2 border-line bg-surface px-6 text-body text-ink';

	function say(text: string) {
		toast = text;
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (toast = ''), 4000);
	}

	async function loadStars(id: string) {
		const res = await fetch(`/api/members/${id}/stars?limit=50`).catch(() => null);
		if (res?.status === 401)
			// eslint-disable-next-line svelte/no-navigation-without-resolve
			await goto(`${resolve('/unlock')}?next=${encodeURIComponent('/settings/stars')}`);
		if (!res?.ok) return;
		const s = (await res.json()) as { balance: number; history: LedgerRow[] };
		balances[id] = s.balance;
		rows[id] = s.history;
	}

	onMount(() => {
		void (async () => {
			const res = await fetch('/api/members').catch(() => null);
			if (res?.ok) children = ((await res.json()) as Child[]).filter((m) => m.role === 'child');
			selectedId = children[0]?.id ?? null;
			loaded = true;
			await Promise.all(children.map((c) => loadStars(c.id)));
		})();
		return () => clearTimeout(toastTimer);
	});

	function pick(id: string) {
		selectedId = id;
		delta = 0;
		note = '';
		error = '';
	}

	function pickDelta(d: number) {
		delta = delta === d ? 0 : d;
		error = '';
	}

	/** Optimistic: balance and list change at once; both are put back if the server says no. */
	async function submit() {
		const child = selected;
		if (!child) return;
		// Snapshot first: the optimistic balance change below re-derives `plan`.
		const chosen = plan;
		if (!chosen.ok) {
			error = chosen.error;
			return;
		}
		const id = child.id;
		const before = { balance: balances[id] ?? 0, rows: rows[id] ?? [] };
		const temp: LedgerRow = {
			id: `tmp-${Date.now()}`,
			delta: chosen.delta,
			reason: chosen.delta > 0 ? 'bonus' : 'adjustment',
			note: chosen.note,
			status: 'approved',
			createdAt: Date.now()
		};
		balances[id] = before.balance + chosen.delta;
		rows[id] = [temp, ...before.rows];
		const sent = { delta: chosen.delta, note: chosen.note };
		const clamped = chosen.clamped;
		delta = 0;
		note = '';
		error = '';
		const res = await fetch(`/api/members/${id}/bonus`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(sent)
		}).catch(() => null);
		if (res?.ok) {
			const n = Math.abs(sent.delta);
			const unit = n === 1 ? 'star' : 'stars';
			say(
				sent.delta > 0
					? `${n} ${unit} for ${child.name}! ⭐`
					: `Removed ${n} ${unit} from ${child.name}${clamped ? ' (all they had)' : ''}.`
			);
		} else {
			balances[id] = before.balance;
			rows[id] = before.rows;
			say("That didn't go through. Please try again.");
		}
		await loadStars(id);
	}

	const when = (ms: number) =>
		new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
</script>

<svelte:head><title>Give or remove stars · Home Hub</title></svelte:head>

<section class="mx-auto flex w-full max-w-4xl flex-col gap-8 p-8 max-sm:p-3">
	<h1 class="text-headline font-extrabold">Give or remove stars</h1>

	{#if loaded && children.length === 0}
		<p class="text-lead text-ink-muted" data-testid="stars-empty">
			No children yet. Add your family in Settings, then Family.
		</p>
	{/if}

	{#if selected}
		<nav aria-label="Whose stars?" class="flex flex-wrap gap-4" data-testid="stars-members">
			{#each children as c (c.id)}
				<button
					type="button"
					aria-pressed={c.id === selectedId}
					aria-label={c.name}
					data-testid="stars-member"
					data-member={c.id}
					onclick={() => pick(c.id)}
					class="flex min-h-tap min-w-tap items-center gap-3 rounded-card p-2 pr-5 transition-transform duration-75 active:scale-95 {c.id ===
					selectedId
						? 'bg-surface-raised shadow-raised ring-4 ring-ink'
						: 'bg-surface-raised'}"
				>
					<MemberAvatar name={c.name} color={c.color} avatar={c.avatar} />
					<span class="text-body font-bold">{c.name}</span>
				</button>
			{/each}
		</nav>

		<Card class="flex flex-col gap-6 !p-6 max-sm:!p-4">
			<p class="text-lead font-bold" data-testid="stars-balance">
				{selected.name} has {balance} ⭐
			</p>

			<div class="flex flex-col gap-3">
				<span class="text-caption text-ink-muted">How many?</span>
				<div class="flex flex-wrap gap-3" role="group" aria-label="Amount">
					{#each AMOUNTS as n (n)}
						<button
							type="button"
							data-testid="amount"
							aria-pressed={delta === n}
							onclick={() => pickDelta(n)}
							class="{chip} {delta !== n
								? 'border-line bg-surface-raised'
								: n > 0
									? 'border-accent bg-accent text-on-accent'
									: 'border-danger bg-danger text-on-accent'}"
							>{n > 0 ? '+' : '−'}{Math.abs(n)}</button
						>
					{/each}
				</div>
			</div>

			<div class="flex flex-col gap-3">
				<span class="text-caption text-ink-muted">Why?</span>
				<div class="flex flex-wrap gap-3" role="group" aria-label="Quick reasons">
					{#each QUICK_REASONS as r (r)}
						<button
							type="button"
							data-testid="reason"
							onclick={() => (note = r)}
							class="{chip} border-line bg-surface-raised">{r}</button
						>
					{/each}
				</div>
				<label class="flex flex-col gap-2">
					<span class="text-caption text-ink-muted"
						>Note {delta < 0 ? '(needed to remove stars)' : '(optional)'}</span
					>
					<input class={field} bind:value={note} maxlength={MAX_NOTE} data-testid="stars-note" />
				</label>
			</div>

			{#if error}
				<p class="text-body text-danger" role="alert" data-testid="stars-error">{error}</p>
			{:else if delta < 0 && -delta > balance && balance > 0}
				<p class="text-body text-ink-muted" data-testid="stars-clamp">
					{selected.name} only has {balance}, so that takes them to 0.
				</p>
			{/if}

			<Button
				variant={delta < 0 ? 'danger' : 'primary'}
				disabled={delta === 0}
				onclick={() => void submit()}
				data-testid="stars-submit">{actionLabel(delta)}</Button
			>
		</Card>

		<div class="flex flex-col gap-4">
			<h2 class="text-title font-bold">Recent star activity</h2>
			{#if activity.length === 0}
				<p class="text-body text-ink-muted" data-testid="activity-empty">
					No bonuses or removals yet.
				</p>
			{/if}
			<ul class="flex flex-col gap-3">
				{#each activity as r (r.id)}
					<li
						data-testid="activity-row"
						class="flex items-center gap-4 rounded-card bg-surface-raised p-4"
					>
						<span class="flex min-w-0 flex-1 flex-col">
							<span class="text-body font-bold">{activityTitle(r)}</span>
							<span class="text-caption text-ink-muted"
								>{r.reason === 'streak' ? 'Streak · ' : ''}{when(r.createdAt)}</span
							>
						</span>
						<span class="text-lead font-extrabold"
							>{r.delta > 0 ? '+' : '−'}{Math.abs(r.delta)} ⭐</span
						>
					</li>
				{/each}
			</ul>
		</div>
	{/if}
</section>

<div
	class="pointer-events-none fixed inset-x-0 bottom-6 z-30 flex justify-center pr-safe-4 pb-safe-0 pl-safe-4"
	aria-live="polite"
>
	{#if toast}
		<p
			data-testid="toast"
			class="rounded-chip bg-ink px-8 py-4 text-body font-bold text-surface shadow-float"
		>
			{toast}
		</p>
	{/if}
</div>
