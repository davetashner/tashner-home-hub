<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';

	type Status =
		| { state: 'not_configured' }
		| { state: 'disconnected' }
		| { state: 'reconnect'; displayName: string }
		| { state: 'connected'; displayName: string };

	let status = $state<Status | null>(null);
	const RESULTS: Record<string, string> = {
		connected: '',
		denied: 'Spotify sign-in was cancelled.',
		failed: 'Spotify did not accept that sign-in. Try again.',
		error: 'That Spotify sign-in expired or did not match. Try again.'
	};
	const note = RESULTS[page.url.searchParams.get('spotify') ?? ''] ?? '';

	onMount(async () => {
		const res = await fetch('/api/spotify/status');
		status = res.ok ? await res.json() : { state: 'disconnected' };
	});

	async function disconnect() {
		status = { state: 'disconnected' };
		await fetch('/api/spotify/disconnect', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{}'
		});
	}
</script>

<svelte:head><title>Music settings</title></svelte:head>

<section class="mx-auto flex w-full max-w-5xl flex-col gap-8 p-8 max-sm:p-3 short:gap-4 short:p-3">
	<h1 class="text-headline font-extrabold">Music</h1>
	{#if note}<p class="text-danger" role="alert">{note}</p>{/if}

	{#if status}
		<Card class="flex flex-col gap-4" data-testid="spotify-card">
			{#if status.state === 'not_configured'}
				<p class="text-lead font-bold" data-testid="spotify-state">Spotify isn't set up</p>
				<p class="text-body text-ink-muted">
					Create a free Spotify developer app and add its client id as
					<code>HUB_SPOTIFY_CLIENT_ID</code> in the hub .env, then restart the hub. Steps are in
					<code>docs/setup/spotify.md</code>.
				</p>
			{:else if status.state === 'connected'}
				<p class="text-lead font-bold" data-testid="spotify-state">
					Connected as {status.displayName}
				</p>
				<div><Button variant="secondary" onclick={disconnect}>Disconnect</Button></div>
			{:else}
				<p class="text-lead font-bold" data-testid="spotify-state">
					{status.state === 'reconnect'
						? `Spotify needs to be reconnected (${status.displayName})`
						: 'Spotify is not connected'}
				</p>
				<p class="text-body text-ink-muted">
					Sign in with the Spotify Premium account the family shares for music.
				</p>
				<!-- A browser navigation to Spotify, not a fetch: the login answers with a redirect. -->
				<div>
					<Button
						data-testid="spotify-connect"
						onclick={() => (window.location.href = '/api/spotify/login')}
					>
						Connect Spotify
					</Button>
				</div>
			{/if}
		</Card>
	{/if}
</section>
