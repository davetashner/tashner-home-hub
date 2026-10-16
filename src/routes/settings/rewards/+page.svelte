<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';

	interface Reward {
		id: string;
		title: string;
		image: string | null;
		cost: number;
	}

	let rewards = $state<Reward[]>([]);
	let loaded = $state(false);
	let message = $state('');
	/** null = form closed; '' = adding; otherwise the id being edited. */
	let editing = $state<string | null>(null);
	let title = $state('');
	let cost = $state('');
	let image = $state('');

	async function load() {
		const res = await fetch('/api/rewards');
		rewards = res.ok ? await res.json() : [];
		loaded = true;
	}
	onMount(load);

	function openForm(r?: Reward) {
		editing = r?.id ?? '';
		title = r?.title ?? '';
		cost = r ? String(r.cost) : '';
		image = r?.image ?? '';
		message = '';
	}

	async function save(e: SubmitEvent) {
		e.preventDefault();
		const body = { title, cost: Number(cost), image: image.trim() || null };
		const res = await fetch(editing ? `/api/rewards/${editing}` : '/api/rewards', {
			method: editing ? 'PATCH' : 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		if (!res.ok) {
			message = (await res.json().catch(() => null))?.message ?? 'Could not save';
			return;
		}
		editing = null;
		await load();
	}

	async function archive(r: Reward) {
		await fetch(`/api/rewards/${r.id}/archive`, { method: 'POST' });
		await load();
	}

	const field =
		'min-h-tap w-full rounded-control border-2 border-line bg-surface px-6 text-body text-ink';
</script>

<svelte:head><title>Rewards</title></svelte:head>

<main class="mx-auto flex w-full max-w-5xl flex-col gap-8 p-8">
	<header class="flex flex-wrap items-center justify-between gap-6">
		<h1 class="text-headline font-extrabold">Rewards</h1>
		<Button data-testid="add-reward" onclick={() => openForm()}>Add reward</Button>
	</header>

	{#if editing !== null}
		<Card elevation="float">
			<form class="flex flex-col gap-6" onsubmit={save} data-testid="reward-form">
				<div class="flex flex-wrap gap-6">
					<label class="flex flex-col gap-2">
						<span class="text-caption text-ink-muted">Emoji</span>
						<input class="{field} w-40 text-center" bind:value={image} data-testid="reward-image" />
					</label>
					<label class="flex min-w-64 flex-1 flex-col gap-2">
						<span class="text-caption text-ink-muted">Name</span>
						<input
							class={field}
							bind:value={title}
							maxlength="60"
							required
							data-testid="reward-title"
						/>
					</label>
					<label class="flex flex-col gap-2">
						<span class="text-caption text-ink-muted">Stars</span>
						<input
							class="{field} w-48"
							type="number"
							inputmode="numeric"
							min="1"
							max="10000"
							bind:value={cost}
							required
							data-testid="reward-cost"
						/>
					</label>
				</div>
				{#if message}<p class="text-danger" role="alert">{message}</p>{/if}
				<div class="flex gap-4">
					<Button type="submit" data-testid="reward-save">Save</Button>
					<Button variant="secondary" onclick={() => (editing = null)}>Cancel</Button>
				</div>
			</form>
		</Card>
	{/if}

	{#if loaded && rewards.length === 0}
		<p class="text-lead text-ink-muted">No rewards yet. Add the first one.</p>
	{/if}

	<ul class="flex flex-col gap-4">
		{#each rewards as r (r.id)}
			<li data-testid="reward-row">
				<Card class="flex flex-wrap items-center gap-6 !p-6">
					<span class="w-24 text-center text-headline" aria-hidden="true">{r.image ?? '🎁'}</span>
					<span class="min-w-48 flex-1 text-lead font-bold">{r.title}</span>
					<span class="text-lead font-extrabold">{r.cost} ⭐</span>
					<Button variant="secondary" onclick={() => openForm(r)} aria-label="Edit {r.title}">
						Edit
					</Button>
					<Button variant="ghost" onclick={() => archive(r)} aria-label="Archive {r.title}">
						Archive
					</Button>
				</Card>
			</li>
		{/each}
	</ul>
</main>
