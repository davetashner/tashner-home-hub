<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import AddConnection from '#lib/components/calendar-settings/AddConnection.svelte';
	import CalendarPicker from '#lib/components/calendar-settings/CalendarPicker.svelte';
	import { api } from '#lib/components/calendar-settings/api.js';
	import type { Source } from '#lib/components/calendar-settings/types.js';
	import { PROVIDER_NAMES, classifyHealth, relativeTime } from '#lib/domain/calendar-health.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	type View = { kind: 'list' } | { kind: 'add' } | { kind: 'edit'; id: string };
	let view = $state<View>({ kind: 'list' });
	let removing = $state<string | null>(null);
	let syncing = $state(false);
	let message = $state('');
	let now = $state(Date.now());

	const icons = { google: '📅', icloud: '☁️', ics: '🔗' } as const;
	const find = (id: string) => data.sources.find((s) => s.id === id);

	onMount(() => {
		const tick = setInterval(() => (now = Date.now()), 30_000);
		return () => clearInterval(tick);
	});

	async function syncNow() {
		syncing = true;
		message = '';
		const res = await api('/api/calendar/sync', 'POST');
		if (!res.ok) message = res.message;
		await invalidateAll();
		now = Date.now();
		syncing = false;
	}

	async function remove(id: string) {
		const res = await api(`/api/calendar/sources/${id}`, 'DELETE');
		if (!res.ok) message = res.message;
		removing = null;
		await invalidateAll();
	}

	/** After a connection is added: refresh, then pick which calendars to show. */
	async function connected(source: Source) {
		await invalidateAll();
		view = { kind: 'edit', id: source.id };
	}

	const backToList = async () => {
		await invalidateAll();
		view = { kind: 'list' };
	};
	const target = $derived(view.kind === 'edit' ? find(view.id) : null);

	// A connection that vanished (deleted elsewhere) sends us back to the list.
	$effect(() => {
		if (view.kind === 'edit' && !target) view = { kind: 'list' };
	});
</script>

<svelte:head><title>Calendars · Home Hub</title></svelte:head>

<section class="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
	<header class="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
		<h1 class="text-headline font-extrabold">Calendars</h1>
		{#if view.kind === 'list'}
			<div class="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
				{#if data.sources.length > 0}
					<Button class="w-full sm:w-auto" variant="secondary" onclick={syncNow} disabled={syncing}
						>{syncing ? 'Syncing…' : 'Sync now'}</Button
					>
				{/if}
				<Button class="w-full sm:w-auto" onclick={() => (view = { kind: 'add' })}
					>Add connection</Button
				>
			</div>
		{/if}
	</header>

	{#if view.kind === 'list'}
		{#if message}<p role="alert" class="text-body font-bold text-danger">{message}</p>{/if}
		<ul class="flex flex-col gap-4" data-testid="source-list">
			{#each data.sources as s (s.id)}
				{@const health = classifyHealth(
					{
						needsReauth: s.needsReauth,
						lastError: s.status?.lastError ?? null,
						lastSyncAt: s.lastSyncAt
					},
					now
				)}
				<li>
					<Card>
						<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
							<span class="shrink-0 text-lead leading-none sm:text-display" aria-hidden="true"
								>{icons[s.provider]}</span
							>
							<div class="min-w-0 sm:flex-1">
								<p class="text-title font-extrabold wrap-break-word">{s.label}</p>
								<p class="truncate text-caption text-ink-muted">
									{PROVIDER_NAMES[s.provider]}{(s.account ?? s.host)
										? ` · ${s.account ?? s.host}`
										: ''}
								</p>
								<p
									class="mt-2 flex flex-col items-start gap-2 text-caption sm:flex-row sm:flex-wrap sm:items-center sm:gap-3"
								>
									<Badge tone={health.tone}>{health.chip}</Badge>
									<span class="text-ink-muted">{health.text}</span>
								</p>
							</div>
						</div>
						{#if removing === s.id}
							<div class="mt-6 flex flex-col gap-3">
								<p class="text-body">Remove {s.label}? Its events disappear from the calendar.</p>
								<div class="flex gap-3">
									<Button variant="danger" onclick={() => remove(s.id)}>Yes, remove</Button>
									<Button variant="secondary" onclick={() => (removing = null)}>Keep</Button>
								</div>
							</div>
						{:else}
							<div class="mt-6 flex flex-wrap gap-3">
								<Button variant="secondary" onclick={() => (view = { kind: 'edit', id: s.id })}
									>Edit</Button
								>
								<Button variant="ghost" onclick={() => (removing = s.id)}>Delete</Button>
							</div>
						{/if}
					</Card>
				</li>
			{:else}
				<li class="text-lead text-ink-muted">
					No calendars yet. Tap "Add connection" to bring in Google, iCloud or a school link.
				</li>
			{/each}
		</ul>
		<p class="text-caption text-ink-muted">
			Last checked {relativeTime(
				Math.max(0, ...data.sources.map((s) => s.status?.lastAttemptAt ?? s.lastSyncAt ?? 0)) ||
					null,
				now
			)}. The hub also checks by itself every few minutes.
		</p>
	{:else if view.kind === 'add'}
		<AddConnection ondone={connected} oncancel={backToList} />
	{:else if view.kind === 'edit' && target}
		<Card elevation="float">
			{#key target.id}
				<CalendarPicker
					source={target}
					people={data.people}
					onsaved={backToList}
					oncancel={backToList}
				/>
			{/key}
		</Card>
	{/if}
</section>
