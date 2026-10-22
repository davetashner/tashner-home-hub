<script lang="ts">
	import { untrack } from 'svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import MemberAvatar from '#lib/components/MemberAvatar.svelte';
	import { api } from './api.js';
	import type { PersonOption, Source } from './types.js';

	interface Props {
		source: Source;
		people: PersonOption[];
		onsaved: () => void | Promise<void>;
		oncancel: () => void;
	}
	let { source, people, onsaved, oncancel }: Props = $props();

	let rows = $state(untrack(() => source.calendars.map((c) => ({ ...c }))));
	let saving = $state(false);
	let message = $state('');

	async function save() {
		saving = true;
		message = '';
		const res = await api(`/api/calendar/sources/${source.id}`, 'PATCH', {
			calendars: rows.map(({ externalId, memberId, selected }) => ({
				externalId,
				memberId,
				selected
			}))
		});
		if (!res.ok) {
			message = res.message;
			saving = false;
			return;
		}
		await api('/api/calendar/sync', 'POST');
		saving = false;
		await onsaved();
	}

	const chip =
		'inline-flex min-h-tap min-w-tap items-center justify-center gap-2 rounded-chip border-2 px-3 text-body font-bold';
</script>

<div class="flex flex-col gap-6" data-testid="calendar-picker">
	<div>
		<h2 class="text-title font-extrabold">Choose calendars for {source.label}</h2>
		<p class="text-body text-ink-muted">
			Turn on the ones to show, and tap who each belongs to. Events get that person's color.
		</p>
	</div>

	<ul class="flex flex-col gap-4">
		{#each rows as row (row.externalId)}
			<li class="flex flex-col gap-4 rounded-card bg-surface-sunken p-6">
				<label class="flex min-h-tap cursor-pointer items-center gap-4">
					<input type="checkbox" bind:checked={row.selected} class="peer sr-only" />
					<span
						aria-hidden="true"
						class="flex size-tap shrink-0 items-center justify-center rounded-control border-2 border-line bg-surface text-title text-transparent peer-checked:border-accent peer-checked:bg-accent peer-checked:text-on-accent peer-focus-visible:outline-4 peer-focus-visible:outline-accent"
						>✓</span
					>
					<span class="text-lead font-bold">{row.name || 'Calendar'}</span>
				</label>
				{#if row.selected}
					<div role="group" aria-label="Whose calendar is {row.name}?" class="flex flex-wrap gap-3">
						<button
							type="button"
							aria-pressed={row.memberId === null}
							class="{chip} {row.memberId === null
								? 'border-accent bg-accent-soft text-accent-press'
								: 'border-control-line bg-control text-ink'}"
							onclick={() => (row.memberId = null)}>Everyone</button
						>
						{#each people as p (p.id)}
							<button
								type="button"
								aria-pressed={row.memberId === p.id}
								aria-label={p.name}
								class="{chip} pr-5 {row.memberId === p.id
									? 'border-accent bg-accent-soft text-accent-press'
									: 'border-control-line bg-control text-ink'}"
								onclick={() => (row.memberId = p.id)}
							>
								<MemberAvatar name={p.name} color={p.color} avatar={p.avatar} size="sm" />
								{p.name}
							</button>
						{/each}
					</div>
				{/if}
			</li>
		{:else}
			<li class="text-body text-ink-muted">No calendars were found on this account.</li>
		{/each}
	</ul>

	{#if message}<p role="alert" class="text-body font-bold text-danger">{message}</p>{/if}
	<div class="flex flex-wrap gap-4">
		<Button onclick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
		<Button variant="secondary" onclick={oncancel}>Cancel</Button>
	</div>
</div>
