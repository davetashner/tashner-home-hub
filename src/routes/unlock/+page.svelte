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
	class="flex min-h-dvh flex-col items-center justify-center gap-8 bg-surface p-safe-8 text-ink max-sm:gap-3 max-sm:p-safe-4 short:grid short:grid-cols-2 short:content-center short:items-center short:gap-x-6 short:gap-y-2 short:p-safe-2"
>
	<h1 class="text-headline font-extrabold max-sm:text-title short:col-start-1 short:text-title">Grown-ups only</h1>

	{#if data.adults.length === 0}
		<p class="text-body text-ink-muted">No adult PIN has been set up yet.</p>
	{:else if !memberId}
		<p class="text-lead short:col-start-1">Who is unlocking?</p>
		<div class="flex flex-wrap justify-center gap-4 max-sm:gap-2 short:col-start-1">
			{#each data.adults as adult (adult.id)}
				<Button variant="secondary" onclick={() => (chosenId = adult.id)}>{adult.name}</Button>
			{/each}
		</div>
	{:else}
		{#if data.adults.length > 1}
			<p class="flex max-w-full min-w-0 items-center gap-2 text-body short:col-start-1">
				<span class="shrink-0">Unlocking as</span>
				<strong class="min-w-0 truncate">{data.adults.find((a) => a.id === memberId)?.name}</strong>
				<Button variant="ghost" class="px-2!" onclick={() => (chosenId = undefined)}>Change</Button>
			</p>
		{/if}
		<PinPad onsubmit={submit} split />
		<label
			class="flex min-h-tap items-center gap-4 text-body max-sm:gap-3 short:col-start-1 short:row-start-4"
		>
			<input type="checkbox" class="h-8 w-8" bind:checked={remember} />
			This is my own phone (stay unlocked)
		</label>
	{/if}
</main>
