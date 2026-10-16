<script lang="ts">
	import { onMount } from 'svelte';
	import { fly } from 'svelte/transition';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import MemberAvatar from '#lib/components/MemberAvatar.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import { groupByChild, relativeTime, type PendingItem } from '#lib/domain/approvals.js';
	import type { MemberColor } from '#lib/domain/member-colors.js';

	interface Child {
		id: string;
		name: string;
		role: string;
		color: MemberColor;
		avatar: string | null;
	}

	let items = $state<PendingItem[]>([]);
	/** Approved completions from the last week; adults can undo any of them (CHO-6). */
	let recent = $state<PendingItem[]>([]);
	let children = $state<Child[]>([]);
	let balances = $state<Record<string, number>>({});
	let loaded = $state(false);
	let now = $state(Date.now());
	let toast = $state('');
	let toastTimer: ReturnType<typeof setTimeout> | undefined;

	const groups = $derived(groupByChild(items));
	const recentGroups = $derived(groupByChild(recent));
	// Children with something waiting come first.
	const rows = $derived(
		children
			.map((child) => ({
				child,
				group: groups.find((g) => g.memberId === child.id),
				done: recentGroups.find((g) => g.memberId === child.id)
			}))
			.sort((a, b) => Number(!!b.group) - Number(!!a.group))
	);

	function say(message: string) {
		toast = message;
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (toast = ''), 4000);
	}

	/** JSON fetch; a lost session sends the grown-up to the PIN pad and back. */
	async function api(url: string, init?: { method: string; body?: unknown }): Promise<Response> {
		const res = await fetch(url, {
			method: init?.method,
			headers: { 'content-type': 'application/json' },
			body: init ? JSON.stringify(init.body ?? {}) : undefined
		});
		if (res.status === 401) {
			// eslint-disable-next-line svelte/no-navigation-without-resolve
			await goto(`${resolve('/unlock')}?next=${encodeURIComponent('/settings/approvals')}`);
		}
		return res;
	}

	async function loadBalances() {
		await Promise.all(
			children.map(async (c) => {
				const res = await fetch(`/api/members/${c.id}/stars`);
				if (res.ok) balances[c.id] = ((await res.json()) as { balance: number }).balance;
			})
		);
	}

	async function load() {
		const [approvals, members, done] = await Promise.all([
			api('/api/approvals'),
			fetch('/api/members'),
			fetch('/api/completions?days=7')
		]);
		if (approvals.ok) items = await approvals.json();
		if (done.ok) recent = await done.json();
		if (members.ok)
			children = ((await members.json()) as Child[]).filter((m) => m.role === 'child');
		await loadBalances();
		now = Date.now();
		loaded = true;
	}

	onMount(() => {
		void load();
		const tick = setInterval(() => (now = Date.now()), 30_000);
		return () => {
			clearInterval(tick);
			clearTimeout(toastTimer);
		};
	});

	/** Removes rows at once, puts them back (gently) if the server says no. */
	async function resolveItems(
		taken: PendingItem[],
		call: (item: PendingItem) => Promise<Response>,
		approved = false
	): Promise<void> {
		const ids = new Set(taken.map((t) => t.completionId));
		items = items.filter((i) => !ids.has(i.completionId));
		const results = await Promise.all(
			taken.map((t) =>
				call(t).then(
					(r) => r.ok,
					() => false
				)
			)
		);
		const failed = taken.filter((_, i) => !results[i]);
		if (failed.length) {
			items = [...items, ...failed].sort((a, b) => a.completedAt - b.completedAt);
			say("That didn't go through. Please try again.");
		} else if (approved) {
			recent = [...taken, ...recent].sort((a, b) => b.completedAt - a.completedAt);
		}
		await loadBalances();
	}

	function approve(taken: PendingItem[]) {
		void resolveItems(
			taken,
			(t) => api(`/api/completions/${t.completionId}/approve`, { method: 'POST' }),
			true
		);
	}

	/** Takes an approved chore's stars back. Optimistic: the row and stars go at once. */
	async function undoDone(item: PendingItem) {
		recent = recent.filter((r) => r.completionId !== item.completionId);
		balances[item.memberId] = (balances[item.memberId] ?? 0) - item.stars;
		const ok = await api(`/api/completions/${item.completionId}/undo`, { method: 'POST' }).then(
			(r) => r.ok,
			() => false
		);
		if (ok) say(`Undone: ${item.choreTitle} (−${item.stars} ⭐)`);
		else {
			recent = [...recent, item].sort((a, b) => b.completedAt - a.completedAt);
			say("That didn't go through. Please try again.");
		}
		await loadBalances();
	}

	// Reject sheet
	let rejecting = $state<PendingItem | null>(null);
	let note = $state('');
	function openReject(item: PendingItem) {
		rejecting = item;
		note = '';
	}
	function confirmReject() {
		const item = rejecting;
		if (!item) return;
		const text = note.trim();
		rejecting = null;
		void resolveItems([item], (t) =>
			api(`/api/completions/${t.completionId}/reject`, {
				method: 'POST',
				body: text ? { note: text } : {}
			})
		);
	}

	// Bonus stars
	let bonusFor = $state<string | null>(null);
	let bonusAmount = $state(1);
	let bonusNote = $state('');
	function openBonus(id: string) {
		bonusFor = bonusFor === id ? null : id;
		bonusAmount = 1;
		bonusNote = '';
	}
	async function giveBonus(child: Child) {
		const amount = bonusAmount;
		const res = await api(`/api/members/${child.id}/bonus`, {
			method: 'POST',
			body: { delta: amount, note: bonusNote.trim() || 'Bonus stars' }
		});
		if (!res.ok) return say("Couldn't give the bonus. Please try again.");
		bonusFor = null;
		say(`${amount} bonus ${amount === 1 ? 'star' : 'stars'} for ${child.name}! ⭐`);
		await loadBalances();
	}

	const field =
		'min-h-tap w-full rounded-control border-2 border-line bg-surface px-6 text-body text-ink';
</script>

<svelte:head><title>Approvals · Home Hub</title></svelte:head>

<section class="mx-auto flex w-full max-w-4xl flex-col gap-8 p-8 portrait:max-sm:p-4">
	<h1 class="text-headline font-extrabold">Approvals</h1>

	{#if loaded && items.length === 0}
		<p class="text-title font-bold" data-testid="all-caught-up">All caught up! ✨</p>
	{/if}

	<ul class="flex flex-col gap-8">
		{#each rows as { child, group, done } (child.id)}
			<li data-testid="child-card" data-member={child.id}>
				<Card class="flex flex-col gap-6 portrait:max-sm:!p-4">
					<div class="flex items-center gap-4">
						<MemberAvatar name={child.name} color={child.color} avatar={child.avatar} />
						<h2 class="min-w-0 flex-1 text-lead font-extrabold break-words sm:text-title">
							{child.name}
						</h2>
						<span class="text-lead font-bold" data-testid="balance-{child.id}">
							{balances[child.id] ?? 0} ⭐
						</span>
					</div>

					{#if group}
						<ul class="flex flex-col gap-4">
							{#each group.items as item (item.completionId)}
								<li
									out:fly|global={{ x: 120, duration: 240, opacity: 0 }}
									data-testid="approval-row"
									class="flex flex-wrap items-center gap-x-6 gap-y-4 rounded-control bg-surface-sunken p-4"
								>
									<span class="text-title leading-none" aria-hidden="true">
										{item.choreIcon ?? '⭐'}
									</span>
									<span class="flex min-w-40 flex-1 flex-col">
										<span class="text-lead font-bold">{item.choreTitle}</span>
										<span class="text-caption text-ink-muted">
											{relativeTime(item.completedAt, now)} · {item.stars}
											{item.stars === 1 ? 'star' : 'stars'}
										</span>
									</span>
									<span class="flex w-full gap-4 sm:w-auto">
										<Button
											class="flex-1"
											data-testid="approve"
											aria-label="Approve {item.choreTitle} for {child.name}"
											onclick={() => approve([item])}>Approve</Button
										>
										<Button
											variant="secondary"
											class="flex-1"
											data-testid="reject"
											aria-label="Not yet: {item.choreTitle} for {child.name}"
											onclick={() => openReject(item)}>Not yet</Button
										>
									</span>
								</li>
							{/each}
						</ul>
						{#if group.items.length > 1}
							<Button
								variant="secondary"
								data-testid="approve-all"
								onclick={() => approve(group.items)}
							>
								Approve all {group.items.length} ({group.stars} ⭐)
							</Button>
						{/if}
					{/if}

					{#if done}
						<div class="flex flex-col gap-4" data-testid="recent-done">
							<h3 class="text-caption font-bold text-ink-muted">Done this week</h3>
							<ul class="flex flex-col gap-4">
								{#each done.items as item (item.completionId)}
									<li
										out:fly|global={{ x: -120, duration: 240, opacity: 0 }}
										data-testid="done-row"
										class="flex flex-wrap items-center gap-x-6 gap-y-4 rounded-control bg-surface-sunken p-4"
									>
										<span class="text-title leading-none" aria-hidden="true">
											{item.choreIcon ?? '⭐'}
										</span>
										<span class="flex min-w-40 flex-1 flex-col">
											<span class="text-lead font-bold">{item.choreTitle}</span>
											<span class="text-caption text-ink-muted">
												{relativeTime(item.completedAt, now)} · {item.stars}
												{item.stars === 1 ? 'star' : 'stars'}
											</span>
										</span>
										<Button
											variant="secondary"
											class="w-full sm:w-auto"
											data-testid="undo-done"
											aria-label="Undo {item.choreTitle} for {child.name}"
											onclick={() => void undoDone(item)}>Undo</Button
										>
									</li>
								{/each}
							</ul>
						</div>
					{/if}

					<div class="flex flex-col gap-4">
						<Button
							variant="ghost"
							class="self-start"
							data-testid="bonus-toggle"
							aria-expanded={bonusFor === child.id}
							onclick={() => openBonus(child.id)}>Give bonus stars</Button
						>
						{#if bonusFor === child.id}
							<form
								class="flex flex-wrap items-center gap-4"
								data-testid="bonus-form"
								onsubmit={(e) => {
									e.preventDefault();
									void giveBonus(child);
								}}
							>
								<span class="flex items-center gap-2">
									<Button
										variant="secondary"
										aria-label="One fewer star"
										disabled={bonusAmount <= 1}
										onclick={() => (bonusAmount -= 1)}>−</Button
									>
									<output
										class="w-20 text-center text-title font-extrabold"
										data-testid="bonus-amount"
									>
										{bonusAmount}
									</output>
									<Button
										variant="secondary"
										aria-label="One more star"
										disabled={bonusAmount >= 5}
										onclick={() => (bonusAmount += 1)}>+</Button
									>
								</span>
								<input
									class="{field} min-w-48 flex-1"
									placeholder="Why? (optional)"
									maxlength="100"
									aria-label="Bonus note"
									bind:value={bonusNote}
								/>
								<Button type="submit" data-testid="bonus-give">Give</Button>
							</form>
						{/if}
					</div>
				</Card>
			</li>
		{/each}
	</ul>
</section>

{#if rejecting}
	<div class="fixed inset-0 z-20 flex items-end justify-center bg-ink/50 sm:items-center">
		<div
			role="dialog"
			aria-modal="true"
			aria-label="Not yet"
			data-testid="reject-sheet"
			class="sheet flex w-full max-w-2xl flex-col gap-6 rounded-t-sheet bg-surface-raised p-8 shadow-float sm:rounded-sheet"
		>
			<h2 class="text-title font-extrabold">Not yet: {rejecting.choreTitle}</h2>
			<label class="flex flex-col gap-2">
				<span class="text-caption text-ink-muted"
					>A short note for {rejecting.memberName} (optional)</span
				>
				<input class={field} maxlength="100" bind:value={note} data-testid="reject-note" />
			</label>
			<div class="flex gap-4">
				<Button class="flex-1" data-testid="reject-confirm" onclick={confirmReject}>
					Send back
				</Button>
				<Button variant="secondary" class="flex-1" onclick={() => (rejecting = null)}>
					Cancel
				</Button>
			</div>
		</div>
	</div>
{/if}

<div
	class="pointer-events-none fixed inset-x-0 bottom-6 z-30 flex justify-center px-4"
	aria-live="polite"
>
	{#if toast}
		<p
			transition:fly={{ y: 40, duration: 240 }}
			data-testid="toast"
			class="rounded-chip bg-ink px-8 py-4 text-body font-bold text-surface shadow-float"
		>
			{toast}
		</p>
	{/if}
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
