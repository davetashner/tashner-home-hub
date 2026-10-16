<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import {
		DEFAULT_IDLE,
		IDLE_SETTINGS_EVENT,
		MAX_IDLE_MINUTES,
		parseIdleSettings,
		type IdleSettings
	} from '#lib/domain/idle.js';

	let settings = $state<IdleSettings>({ ...DEFAULT_IDLE });
	let message = $state('');

	onMount(async () => {
		const res = await fetch('/api/settings/idle').catch(() => null);
		if (res?.ok) settings = parseIdleSettings(await res.json());
	});

	const rows = [
		{
			key: 'homeMinutes',
			title: 'Back to home',
			line: 'Return to the home screen after this long without a touch.'
		},
		{
			key: 'frameMinutes',
			title: 'Photo frame',
			line: 'Start the photo frame after this long without a touch.'
		}
	] as const;

	function change(key: keyof IdleSettings, delta: number) {
		const next = Math.min(MAX_IDLE_MINUTES, Math.max(0, settings[key] + delta));
		if (next === settings[key]) return;
		// Optimistic: the screen and the running timers update before the save lands.
		settings = { ...settings, [key]: next };
		message = '';
		window.dispatchEvent(new CustomEvent(IDLE_SETTINGS_EVENT, { detail: settings }));
		void fetch('/api/settings/idle', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ [key]: next })
		})
			.then((res) => {
				if (!res.ok) message = 'Could not save. Try again.';
			})
			.catch(() => (message = 'Could not save. Try again.'));
	}

	const label = (m: number) => (m === 0 ? 'Off' : m === 1 ? '1 minute' : `${m} minutes`);
</script>

<svelte:head>
	<title>Screen · Settings · Home Hub</title>
</svelte:head>

<section class="mx-auto flex w-full max-w-4xl flex-col gap-8 p-8">
	<h1 class="text-headline font-extrabold">Screen</h1>
	{#each rows as row (row.key)}
		<Card>
			<div class="flex flex-wrap items-center justify-between gap-6">
				<div class="flex flex-col gap-1">
					<h2 class="text-title font-bold">{row.title}</h2>
					<p class="text-body text-ink-muted">{row.line}</p>
				</div>
				<div class="flex items-center gap-4">
					<Button
						variant="secondary"
						aria-label="{row.title}: less"
						disabled={settings[row.key] === 0}
						onclick={() => change(row.key, -1)}>−</Button
					>
					<output class="min-w-tap-kid text-center text-title font-bold" data-testid={row.key}>
						{label(settings[row.key])}
					</output>
					<Button
						variant="secondary"
						aria-label="{row.title}: more"
						onclick={() => change(row.key, 1)}>+</Button
					>
				</div>
			</div>
		</Card>
	{/each}
	<p class="text-body text-ink-muted">Any touch on the photo frame goes back to where you were.</p>
	{#if message}<p role="alert" class="text-body text-danger">{message}</p>{/if}
</section>
