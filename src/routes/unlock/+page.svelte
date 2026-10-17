<script lang="ts">
	import PinPad, { type PinResult } from '#lib/components/PinPad.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import { page } from '$app/state';
	import { defaultRemember, parseDisplayRole } from '#lib/domain/display-role.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let chosenId = $state<string | undefined>();
	let remember = $state(defaultRemember(parseDisplayRole(page.data.displayRole)));
	const memberId = $derived(chosenId ?? (data.adults.length === 1 ? data.adults[0].id : undefined));

	async function submit(pin: string): Promise<PinResult> {
		const response = await fetch('/api/auth/pin', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ memberId, pin, remember })
		});
		if (response.ok) {
			// Full load so the new session cookie reaches server-rendered pages.
			window.location.assign(data.next);
			return { ok: true };
		}
		const body = (await response.json().catch(() => ({}))) as {
			message?: string;
			retryAfterMs?: number;
		};
		return { ok: false, message: body.message ?? 'Wrong PIN.', retryAfterMs: body.retryAfterMs };
	}
</script>

<svelte:head><title>Unlock</title></svelte:head>

<main
	class="flex min-h-dvh flex-col items-center justify-center gap-8 bg-surface p-safe-8 text-ink"
>
	<h1 class="text-headline font-extrabold">Grown-ups only</h1>

	{#if data.adults.length === 0}
		<p class="text-body text-ink-muted">No adult PIN has been set up yet.</p>
	{:else if !memberId}
		<p class="text-lead">Who is unlocking?</p>
		<div class="flex flex-wrap justify-center gap-4">
			{#each data.adults as adult (adult.id)}
				<Button variant="secondary" onclick={() => (chosenId = adult.id)}>{adult.name}</Button>
			{/each}
		</div>
	{:else}
		<PinPad onsubmit={submit} />
		<label class="flex min-h-tap items-center gap-4 text-body">
			<input type="checkbox" class="h-8 w-8" bind:checked={remember} />
			This is my own phone (stay unlocked)
		</label>
	{/if}
</main>
