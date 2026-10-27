<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import { REWARD_EMOJI } from '#lib/domain/emoji.js';
	import { jarCaption } from '#lib/domain/goal-jar.js';
	import MoneyGoals from './MoneyGoals.svelte';

	interface Entry {
		reward: { id: string; title: string; image: string | null; cost: number };
		current: boolean;
		own: boolean;
	}

	let {
		memberId,
		balance,
		onclose,
		onchanged
	}: {
		memberId: string;
		balance: number;
		onclose: () => void;
		/** The current goal changed or one was added/removed: reload the jar. */
		onchanged: () => void;
	} = $props();

	const json = { 'content-type': 'application/json' };
	let entries = $state<Entry[]>([]);
	let loaded = $state(false);
	let message = $state('');
	let tab = $state<'stars' | 'money'>('stars');
	let adding = $state(false);
	let title = $state('');
	let image = $state('');
	let cost = $state(20);

	onMount(() => void load());

	async function load() {
		try {
			const r = await fetch(`/api/members/${memberId}/goals`);
			if (r.ok) entries = (await r.json()) as Entry[];
			else message = 'Your goals could not load. Try again soon!';
		} catch {
			message = 'Your goals could not load. Try again soon!';
		}
		loaded = true;
	}

	async function pick(entry: Entry) {
		if (entry.current) return;
		// Optimistic: the highlight moves at once and rolls back if the server says no.
		const before = entries;
		entries = entries.map((e) => ({ ...e, current: e.reward.id === entry.reward.id }));
		message = '';
		const ok = await fetch(`/api/members/${memberId}/goal`, {
			method: 'PUT',
			headers: json,
			body: JSON.stringify({ rewardId: entry.reward.id })
		}).then(
			(r) => r.ok,
			() => false
		);
		if (ok) {
			message = `${entry.reward.title} is your goal now!`;
			onchanged();
		} else {
			entries = before;
			message = 'Oops, that did not save. Try again!';
		}
	}

	async function remove(entry: Entry) {
		const before = entries;
		entries = entries.filter((e) => e.reward.id !== entry.reward.id);
		const ok = await fetch(`/api/members/${memberId}/goals/${entry.reward.id}`, {
			method: 'DELETE'
		}).then(
			(r) => r.ok,
			() => false
		);
		if (ok) {
			await load();
			onchanged();
		} else {
			entries = before;
			message = 'Oops, that did not remove. Try again!';
		}
	}

	async function add(e: SubmitEvent) {
		e.preventDefault();
		const name = title.trim();
		if (!name) {
			message = 'Give your goal a name!';
			return;
		}
		const res = await fetch(`/api/members/${memberId}/goals`, {
			method: 'POST',
			headers: json,
			body: JSON.stringify({ title: name, cost, image: image || null })
		}).catch(() => null);
		if (!res?.ok) {
			message = 'Oops, that did not save. Try again!';
			return;
		}
		message = `${name} is your goal now!`;
		adding = false;
		title = '';
		image = '';
		cost = 20;
		await load();
		onchanged();
	}

	const bump = (n: number) => (cost = Math.min(10_000, Math.max(1, cost + n)));
</script>

<div class="fixed inset-0 z-20 flex items-end justify-center bg-ink/50 p-0 sm:items-center sm:p-8">
	<div
		role="dialog"
		aria-modal="true"
		aria-label="My goals"
		data-testid="goals-sheet"
		class="sheet flex max-h-full w-full max-w-5xl flex-col gap-6 overflow-y-auto overscroll-contain rounded-t-sheet bg-surface-raised p-8 pb-safe-8 shadow-float sm:rounded-sheet"
	>
		<header class="flex items-center justify-between gap-6">
			<h2 class="text-title leading-none font-extrabold">My goals</h2>
			<Button variant="secondary" size="kid" data-testid="goals-close" onclick={onclose}>
				Close
			</Button>
		</header>
		<div class="flex gap-4" role="tablist" aria-label="Kinds of goals">
			{#each [['stars', 'Stars'], ['money', 'Money']] as const as [id, text] (id)}
				<Button
					variant={tab === id ? 'primary' : 'secondary'}
					size="kid"
					role="tab"
					aria-selected={tab === id}
					data-testid="goals-tab-{id}"
					onclick={() => {
						tab = id;
						message = '';
					}}>{text}</Button
				>
			{/each}
		</div>
		{#if message}
			<p role="status" data-testid="goals-message" class="text-lead font-bold">{message}</p>
		{/if}

		{#if tab === 'money'}
			<MoneyGoals {memberId} onmessage={(t) => (message = t)} />
		{:else if adding}
			<form class="flex flex-col gap-6" data-testid="goal-form" onsubmit={add}>
				<label class="flex flex-col gap-2">
					<span class="text-caption text-ink-muted">What are you saving for?</span>
					<input
						class="min-h-tap-kid w-full rounded-control border-2 border-line bg-surface px-6 text-lead text-ink"
						bind:value={title}
						maxlength="60"
						data-testid="goal-title"
					/>
				</label>
				<div class="flex flex-col gap-2">
					<span class="text-caption text-ink-muted" id="goal-emoji-label">Pick a picture</span>
					<div
						class="flex flex-wrap gap-2"
						role="group"
						aria-labelledby="goal-emoji-label"
						data-testid="goal-emoji-grid"
					>
						{#each REWARD_EMOJI as c (c.emoji)}
							<button
								type="button"
								class="flex size-tap-kid items-center justify-center rounded-control border-2 text-title active:scale-95 {image ===
								c.emoji
									? 'border-accent bg-accent-soft'
									: 'border-line bg-surface'}"
								aria-label={c.label}
								aria-pressed={image === c.emoji}
								data-testid="goal-emoji"
								data-emoji={c.emoji}
								onclick={() => (image = image === c.emoji ? '' : c.emoji)}
							>
								{c.emoji}
							</button>
						{/each}
					</div>
				</div>
				<div class="flex flex-col gap-2">
					<span class="text-caption text-ink-muted">How many stars?</span>
					<div class="flex items-center justify-center gap-2 sm:gap-4">
						<Button
							variant="secondary"
							size="kid"
							class="px-2!"
							aria-label="10 fewer"
							onclick={() => bump(-10)}>-10</Button
						>
						<Button
							variant="secondary"
							size="kid"
							class="px-2!"
							aria-label="1 fewer"
							onclick={() => bump(-1)}>-1</Button
						>
						<p class="min-w-16 text-center text-title font-extrabold" data-testid="goal-cost">
							{cost}
						</p>
						<Button
							variant="secondary"
							size="kid"
							class="px-2!"
							aria-label="1 more"
							data-testid="goal-cost-up"
							onclick={() => bump(1)}>+1</Button
						>
						<Button
							variant="secondary"
							size="kid"
							class="px-2!"
							aria-label="10 more"
							onclick={() => bump(10)}>+10</Button
						>
					</div>
				</div>
				<div class="flex flex-wrap gap-4">
					<Button type="submit" size="kid" class="px-2!" data-testid="goal-save">Save goal</Button>
					<Button variant="secondary" size="kid" onclick={() => (adding = false)}>Not now</Button>
				</div>
			</form>
		{:else}
			{#if !loaded}
				<p class="text-lead text-ink-muted" aria-busy="true">Loading...</p>
			{:else if entries.length === 0}
				<p class="text-lead text-ink-muted">No goals yet. Make your own!</p>
			{:else}
				<ul class="grid grid-cols-1 gap-6 landscape:grid-cols-2" data-testid="goals-list">
					{#each entries as entry (entry.reward.id)}
						<li
							data-testid="goal-card"
							data-current={entry.current}
							class="flex flex-col gap-4 rounded-card bg-surface-sunken p-6 {entry.current
								? 'ring-4 ring-ink'
								: ''}"
						>
							<div class="flex items-center gap-6">
								<span class="text-display leading-none" aria-hidden="true"
									>{entry.reward.image ?? '🎁'}</span
								>
								<div class="flex min-w-0 flex-col gap-1">
									<p class="text-lead leading-tight font-extrabold">{entry.reward.title}</p>
									<p class="text-body font-bold text-ink-muted">
										{jarCaption(balance, entry.reward.cost)}
									</p>
								</div>
							</div>
							<div class="flex flex-wrap gap-4">
								{#if entry.current}
									<p class="text-body font-extrabold" data-testid="goal-is-current">
										In my jar now
									</p>
								{:else}
									<Button size="kid" data-testid="goal-pick" onclick={() => void pick(entry)}>
										Show in my jar
									</Button>
								{/if}
								<Button
									variant="secondary"
									size="kid"
									data-testid="goal-remove"
									aria-label="Remove {entry.reward.title}"
									onclick={() => void remove(entry)}>Remove</Button
								>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
			<div>
				<Button size="kid" data-testid="goal-new" onclick={() => (adding = true)}>
					Make a new goal
				</Button>
			</div>
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
