<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { errorMessage, safeFetch } from '#lib/domain/api-error.js';
	import Button from './ui/Button.svelte';
	import Card from './ui/Card.svelte';

	/** Whether kids' to-dos need a grown-up's OK (hub-526). Off: kids self-serve. */
	interface Props {
		on: boolean;
		/** How many to-dos still need a grown-up's OK. */
		checked: number;
	}
	let { on, checked }: Props = $props();

	/* svelte-ignore state_referenced_locally */
	let current = $state(on);
	let busy = $state(false);
	let message = $state<string>();

	async function send(method: 'PUT' | 'POST', body?: unknown): Promise<boolean> {
		const res = await safeFetch('/api/settings/approval', {
			method,
			headers: { 'content-type': 'application/json' },
			body: body === undefined ? undefined : JSON.stringify(body)
		});
		message = res.ok ? undefined : await errorMessage(res);
		return res.ok;
	}

	async function toggle() {
		const next = !current;
		current = next; // optimistic
		if (!(await send('PUT', { on: next }))) current = !next;
	}

	async function turnOffAll() {
		busy = true;
		const was = current;
		current = false;
		if (await send('POST')) await invalidateAll();
		else current = was;
		busy = false;
	}
</script>

<Card class="flex flex-col gap-4" data-testid="approval-setting">
	<div class="flex items-center gap-4">
		<div class="min-w-0 flex-1">
			<h2 class="text-lead font-bold">A grown-up checks new to-dos</h2>
			<p class="text-body text-ink-muted">
				{current
					? 'New to-dos wait for a grown-up before their stars count.'
					: 'Kids tick off their own to-dos and get their stars right away.'}
			</p>
		</div>
		<button
			type="button"
			role="switch"
			aria-checked={current}
			aria-label="A grown-up checks new to-dos"
			data-testid="approval-switch"
			class="press min-h-tap min-w-tap rounded-chip px-6 text-body font-extrabold {current
				? 'bg-success text-on-accent'
				: 'bg-surface-sunken text-ink-muted'}"
			onclick={toggle}
		>
			{current ? 'On' : 'Off'}
		</button>
	</div>
	{#if checked > 0}
		<div class="flex flex-wrap items-center gap-4">
			<p class="flex-1 text-body">
				{checked}
				{checked === 1 ? 'to-do still needs' : 'to-dos still need'} a grown-up's OK.
			</p>
			<Button variant="secondary" disabled={busy} onclick={turnOffAll}>
				Turn off approval on all to-dos
			</Button>
		</div>
	{/if}
	{#if message}<p role="alert" class="text-body font-bold text-danger">{message}</p>{/if}
</Card>
