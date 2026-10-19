<script lang="ts">
	import { errorMessage, safeFetch } from '#lib/domain/api-error.js';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import SpeakerSettings from '#lib/components/music/SpeakerSettings.svelte';

	type Status =
		| { state: 'not_configured' }
		| { state: 'disconnected' }
		| { state: 'reconnect'; displayName: string }
		| { state: 'connected'; displayName: string };

	interface Playlist {
		id: string;
		name: string;
		cover: string | null;
		tracks: number;
	}
	interface Device {
		id: string;
		name: string;
	}
	interface Config {
		playlists: Playlist[];
		volumeCap: number;
		timerMinutes: number;
		device: string | null;
	}
	const TIMERS = [0, 10, 15, 20, 30];

	let status = $state<Status | null>(null);
	let config = $state<Config | null>(null);
	let library = $state<Playlist[] | null>(null);
	let devices = $state<Device[] | null>(null);
	let libraryError = $state('');
	let saveError = $state('');

	const enabled = $derived(new Set(config?.playlists.map((p) => p.id)));
	/** The parent's Spotify playlists, plus any switched-on ones Spotify no longer lists. */
	const rows = $derived.by(() => {
		const all = [...(library ?? [])];
		for (const p of config?.playlists ?? []) if (!all.some((x) => x.id === p.id)) all.push(p);
		return all;
	});
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
		const c = await fetch('/api/music/settings');
		if (c.ok) config = await c.json();
		if (status?.state === 'connected') {
			const [lib, dev] = await Promise.all([
				fetch('/api/music/library'),
				fetch('/api/music/devices')
			]);
			if (lib.ok) library = await lib.json();
			else libraryError = 'Could not load your Spotify playlists. Try again in a moment.';
			devices = dev.ok ? await dev.json() : [];
		}
	});

	/** Saves go out one at a time, so the server applies them in tap order. */
	let queue: Promise<unknown> = Promise.resolve();
	let inFlight = 0;

	/** Optimistic: show the change, then save; the server's repaired copy wins once the last save lands. */
	function save(patch: Partial<Config>) {
		if (!config) return;
		const before = config;
		config = { ...config, ...patch };
		saveError = '';
		inFlight++;
		const run = queue.then(() => sendNow(patch, before));
		queue = run.catch(() => undefined);
		return run;
	}

	async function sendNow(patch: Partial<Config>, before: Config) {
		const res = await safeFetch('/api/music/settings', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(patch)
		});
		inFlight--;
		if (res.ok) {
			// An older reply must not undo a newer tap that is still on its way.
			const next: Config = await res.json();
			if (inFlight === 0) config = next;
		} else {
			// Undo only this tap's fields; other taps keep their optimistic values.
			if (config) {
				const undo: Partial<Config> = {};
				for (const k of Object.keys(patch) as (keyof Config)[])
					Object.assign(undo, { [k]: before[k] });
				config = { ...config, ...undo };
			}
			saveError = res.status < 500 ? 'Could not save that. Try again.' : await errorMessage(res);
		}
	}

	function toggle(p: Playlist) {
		if (!config) return;
		const on = enabled.has(p.id);
		save({
			playlists: on ? config.playlists.filter((x) => x.id !== p.id) : [...config.playlists, p]
		});
	}

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

		{#if status.state === 'connected' && config}
			<Card class="flex flex-col gap-4" data-testid="music-playlists">
				<h2 class="text-lead font-bold">Playlists kids can pick</h2>
				<p class="text-body text-ink-muted">
					Only playlists switched on here show up for kids. They can never search.
				</p>
				{#if libraryError}<p class="text-danger" role="alert">{libraryError}</p>{/if}
				{#if library === null && !libraryError}
					<p class="text-body text-ink-muted">Loading your playlists...</p>
				{:else if rows.length === 0}
					<p class="text-body text-ink-muted">No playlists found in this Spotify account.</p>
				{/if}
				<ul class="flex flex-col gap-3">
					{#each rows as p (p.id)}
						<li class="flex items-center gap-4">
							{#if p.cover}
								<img
									src={p.cover}
									alt=""
									class="size-tap shrink-0 rounded-control object-cover"
									loading="lazy"
								/>
							{:else}
								<span class="size-tap shrink-0 rounded-control bg-surface-sunken"></span>
							{/if}
							<span class="min-w-0 flex-1">
								<span class="block truncate text-body font-bold">{p.name}</span>
								<span class="block text-caption text-ink-muted">{p.tracks} tracks</span>
							</span>
							<button
								type="button"
								role="switch"
								aria-checked={enabled.has(p.id)}
								aria-label="Kids can play {p.name}"
								data-testid="playlist-switch"
								class="press min-h-tap min-w-tap rounded-chip px-6 text-body font-extrabold {enabled.has(
									p.id
								)
									? 'bg-success text-on-accent'
									: 'bg-surface-sunken text-ink-muted'}"
								onclick={() => toggle(p)}
							>
								{enabled.has(p.id) ? 'On' : 'Off'}
							</button>
						</li>
					{/each}
				</ul>
			</Card>

			<Card class="flex flex-col gap-4" data-testid="music-device">
				<h2 class="text-lead font-bold">Play on</h2>
				<p class="text-body text-ink-muted">
					The Hub speaker is used when it is on. Until then, pick a phone or computer that has
					Spotify open.
				</p>
				<div class="flex flex-wrap gap-3">
					<button
						type="button"
						aria-pressed={config.device === null}
						class="press min-h-tap rounded-chip px-6 text-body font-extrabold {config.device ===
						null
							? 'bg-accent text-on-accent'
							: 'bg-surface-sunken text-ink'}"
						onclick={() => save({ device: null })}
					>
						Automatic (Hub)
					</button>
					{#each devices ?? [] as d (d.id)}
						<button
							type="button"
							aria-pressed={config.device === d.name}
							class="press min-h-tap rounded-chip px-6 text-body font-extrabold {config.device ===
							d.name
								? 'bg-accent text-on-accent'
								: 'bg-surface-sunken text-ink'}"
							onclick={() => save({ device: d.name })}
						>
							{d.name}
						</button>
					{/each}
				</div>
				{#if devices && devices.length === 0}
					<p class="text-caption text-ink-muted">
						No devices are online right now. Open Spotify on a phone or computer to see it here.
					</p>
				{/if}
			</Card>

			<Card class="flex flex-col gap-6" data-testid="music-limits">
				<h2 class="text-lead font-bold">Limits</h2>
				<label class="flex flex-col gap-2">
					<span class="text-body font-bold">
						Loudest volume kids can pick: <span data-testid="cap-value">{config.volumeCap}%</span>
					</span>
					<input
						type="range"
						min="20"
						max="100"
						step="10"
						value={config.volumeCap}
						class="min-h-tap w-full accent-accent"
						data-testid="cap-slider"
						onchange={(e) => save({ volumeCap: Number(e.currentTarget.value) })}
					/>
				</label>
				<div class="flex flex-col gap-2">
					<span class="text-body font-bold">Shower timer: music stops after</span>
					<div class="flex flex-wrap gap-3">
						{#each TIMERS as m (m)}
							<button
								type="button"
								aria-pressed={config.timerMinutes === m}
								class="press min-h-tap min-w-tap rounded-chip px-6 text-body font-extrabold {config.timerMinutes ===
								m
									? 'bg-accent text-on-accent'
									: 'bg-surface-sunken text-ink'}"
								onclick={() => save({ timerMinutes: m })}
							>
								{m === 0 ? 'Off' : `${m} min`}
							</button>
						{/each}
					</div>
				</div>
			</Card>
			{#if saveError}<p class="text-danger" role="alert">{saveError}</p>{/if}
		{/if}
	{/if}

	<SpeakerSettings />
</section>
