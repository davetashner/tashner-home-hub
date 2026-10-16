<script lang="ts">
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import { api } from './api.js';
	import { field, type Source } from './types.js';

	interface Props {
		ondone: (source: Source) => void | Promise<void>;
		oncancel: () => void;
	}
	let { ondone, oncancel }: Props = $props();

	let label = $state('');
	let url = $state('');
	let busy = $state(false);
	let message = $state('');

	async function submit() {
		busy = true;
		message = '';
		const res = await api<Source>('/api/calendar/sources', 'POST', {
			provider: 'ics',
			label: label.trim(),
			url: url.trim()
		});
		busy = false;
		if (!res.ok || !res.data) {
			message = res.message;
			return;
		}
		await ondone(res.data);
	}
</script>

<Card elevation="float" data-testid="add-connection">
	<div class="flex flex-col gap-6">
		<h2 class="text-title font-extrabold">Add a subscription link</h2>
		<p class="text-body">
			Many schools, teams and apps give you a calendar link. Paste it here. Links that start with
			<strong>webcal://</strong> work too.
		</p>
		<label class="flex flex-col gap-2 text-caption text-ink-muted">
			Name this calendar
			<input
				bind:value={label}
				placeholder="School"
				autocomplete="off"
				class={field}
				aria-label="Name this calendar"
			/>
		</label>
		<label class="flex flex-col gap-2 text-caption text-ink-muted">
			Link
			<input
				bind:value={url}
				inputmode="url"
				autocomplete="off"
				autocapitalize="off"
				spellcheck="false"
				placeholder="webcal://example.com/school.ics"
				aria-label="Calendar link"
				class={field}
			/>
		</label>
		{#if message}<p role="alert" class="text-body font-bold text-danger">{message}</p>{/if}
		<div class="flex flex-wrap gap-4">
			<Button onclick={submit} disabled={busy || !url.trim() || !label.trim()}
				>{busy ? 'Checking…' : 'Add'}</Button
			>
			<Button variant="secondary" onclick={oncancel}>Cancel</Button>
		</div>
	</div>
</Card>
