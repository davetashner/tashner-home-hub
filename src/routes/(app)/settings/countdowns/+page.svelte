<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import { countdownLabel, daysUntil, dayIn } from '#lib/domain/countdowns.js';
	import { page } from '$app/state';
	import { isTimeZone, runtimeZone } from '#lib/domain/time-zone.js';

	interface Countdown {
		id: string;
		title: string;
		targetDate: string;
		icon: string | null;
	}

	let items = $state<Countdown[]>([]);
	let loaded = $state(false);
	let message = $state('');
	/** null = form closed; '' = adding; otherwise the id being edited. */
	let editing = $state<string | null>(null);
	let title = $state('');
	let targetDate = $state('');
	let icon = $state('');

	const today = $derived(
		dayIn(Date.now(), isTimeZone(page.data.timeZone) ? page.data.timeZone : runtimeZone())
	);

	function when(c: Countdown): string {
		const days = daysUntil(c.targetDate, today);
		if (days === null) return c.targetDate;
		return days < 0 ? 'Passed' : countdownLabel(days);
	}

	async function load() {
		const res = await fetch('/api/countdowns');
		items = res.ok ? await res.json() : [];
		loaded = true;
	}
	onMount(load);

	function openForm(c?: Countdown) {
		editing = c?.id ?? '';
		title = c?.title ?? '';
		targetDate = c?.targetDate ?? '';
		icon = c?.icon ?? '';
		message = '';
	}

	async function save(e: SubmitEvent) {
		e.preventDefault();
		const res = await fetch(editing ? `/api/countdowns/${editing}` : '/api/countdowns', {
			method: editing ? 'PATCH' : 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ title, targetDate, icon: icon.trim() || null })
		});
		if (!res.ok) {
			message = (await res.json().catch(() => null))?.message ?? 'Could not save';
			return;
		}
		editing = null;
		await load();
	}

	async function remove(c: Countdown) {
		await fetch(`/api/countdowns/${c.id}`, {
			method: 'DELETE',
			headers: { 'content-type': 'application/json' },
			body: '{}'
		});
		await load();
	}

	const field =
		'min-h-tap w-full rounded-control border-2 border-line bg-surface px-6 text-body text-ink';
</script>

<svelte:head><title>Countdowns</title></svelte:head>

<section class="mx-auto flex w-full max-w-5xl flex-col gap-8 p-8 max-sm:p-3">
	<header class="flex flex-wrap items-center justify-between gap-6">
		<h1 class="text-headline font-extrabold">Countdowns</h1>
		<Button data-testid="add-countdown" onclick={() => openForm()}>Add countdown</Button>
	</header>

	{#if editing !== null}
		<Card elevation="float">
			<form class="flex flex-col gap-6" onsubmit={save} data-testid="countdown-form">
				<div class="flex flex-wrap gap-6">
					<label class="flex flex-col gap-2">
						<span class="text-caption text-ink-muted">Emoji</span>
						<input
							class="{field} w-40 text-center max-sm:w-full"
							bind:value={icon}
							data-testid="countdown-icon"
						/>
					</label>
					<label class="flex min-w-64 flex-1 flex-col gap-2 max-sm:min-w-0 max-sm:basis-full">
						<span class="text-caption text-ink-muted">Name</span>
						<input
							class={field}
							bind:value={title}
							maxlength="60"
							required
							data-testid="countdown-title"
						/>
					</label>
					<label class="flex flex-col gap-2 max-sm:w-full">
						<span class="text-caption text-ink-muted">Date</span>
						<input
							class="{field} w-64 max-sm:w-full"
							type="date"
							bind:value={targetDate}
							required
							data-testid="countdown-date"
						/>
					</label>
				</div>
				{#if message}<p class="text-danger" role="alert">{message}</p>{/if}
				<div class="flex gap-4">
					<Button type="submit" data-testid="countdown-save">Save</Button>
					<Button variant="secondary" onclick={() => (editing = null)}>Cancel</Button>
				</div>
			</form>
		</Card>
	{/if}

	{#if loaded && items.length === 0}
		<p class="text-lead text-ink-muted">No countdowns yet. Add the first one.</p>
	{/if}

	<ul class="flex flex-col gap-4">
		{#each items as c (c.id)}
			<li data-testid="countdown-row">
				<Card class="flex flex-wrap items-center gap-6 !p-6 max-sm:!p-4">
					<span class="w-24 text-center text-headline" aria-hidden="true">{c.icon ?? '⏳'}</span>
					<span class="flex min-w-48 flex-1 flex-col">
						<span class="text-lead font-bold">{c.title}</span>
						<span class="text-body text-ink-muted">{c.targetDate}</span>
					</span>
					<span class="text-lead font-extrabold">{when(c)}</span>
					<Button variant="secondary" onclick={() => openForm(c)} aria-label="Edit {c.title}">
						Edit
					</Button>
					<Button variant="ghost" onclick={() => remove(c)} aria-label="Delete {c.title}">
						Delete
					</Button>
				</Card>
			</li>
		{/each}
	</ul>
</section>
