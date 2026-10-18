<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { errorMessage, safeFetch } from '#lib/domain/api-error.js';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import type { ImportView } from '#lib/server/photo-source/google-import.js';

	let {
		folders,
		onimported
	}: { folders: { id: string; label: string }[]; onimported: () => void } = $props();

	let connected = $state(false);
	let job = $state<ImportView | null>(null);
	let consent = $state<{ url: string; state: string }>();
	let pasted = $state('');
	let album = $state('');
	let sourceId = $state('');
	let error = $state<string>();
	let busy = $state(false);
	let timer: ReturnType<typeof setInterval> | undefined;

	const active = $derived(job?.status === 'waiting' || job?.status === 'importing');
	const field = 'min-h-tap rounded-control border-2 border-line bg-surface px-4 text-body';

	async function call(url: string, method = 'GET', body?: unknown) {
		const res = await safeFetch(url, {
			method,
			headers: { 'content-type': 'application/json' },
			body: body === undefined ? undefined : JSON.stringify(body)
		});
		if (!res.ok) {
			error = await errorMessage(res);
			return null;
		}
		error = undefined;
		return res.json();
	}

	async function poll() {
		const r: { connected: boolean; job: ImportView | null } | null = await call(
			'/api/photo-import/google'
		);
		if (!r) return;
		const was = active;
		connected = r.connected;
		job = r.job;
		if (was && r.job?.status === 'done') onimported();
	}

	onMount(() => {
		void poll();
		timer = setInterval(() => {
			if (active) void poll();
		}, 2000);
	});
	onDestroy(() => clearInterval(timer));

	async function connect() {
		busy = true;
		const r = await call('/api/photo-import/google/connect', 'POST');
		busy = false;
		if (r) consent = r;
	}

	async function finish() {
		busy = true;
		const r = await call('/api/photo-import/google/finish', 'POST', {
			pasted,
			state: consent?.state
		});
		busy = false;
		if (r) {
			connected = true;
			consent = undefined;
			pasted = '';
		}
	}

	async function start() {
		busy = true;
		const r: ImportView | null = await call('/api/photo-import/google/session', 'POST', {
			sourceId: sourceId || folders[0]?.id,
			album: album || undefined
		});
		busy = false;
		if (r) job = r;
	}

	async function cancel() {
		const r = await call('/api/photo-import/google', 'DELETE');
		if (r) job = r.job;
	}
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -->

<Card elevation="float">
	<div class="flex flex-col gap-4" data-testid="google-import">
		<h2 class="text-title font-extrabold">Import from Google Photos</h2>
		<p class="text-caption text-ink-muted">
			Google only lets apps see photos you pick yourself. You choose photos or albums in Google's
			own picker on your phone and the hub copies them in. It is a one-time copy, not a live sync.
		</p>
		<details class="text-caption text-ink-muted">
			<summary class="min-h-tap py-3 font-bold">One-time setup in Google Cloud Console</summary>
			<ol class="ml-6 flex list-decimal flex-col gap-1">
				<li>Open the project that holds the hub's OAuth client (the one used for Calendar).</li>
				<li>APIs and services, Library: enable the "Google Photos Picker API".</li>
				<li>
					OAuth consent screen, Data access: add the scope
					<code class="break-all"
						>https://www.googleapis.com/auth/photospicker.mediaitems.readonly</code
					>.
				</li>
				<li>Connect below. Videos are skipped for now.</li>
			</ol>
		</details>

		{#if error}<p role="alert" class="text-body font-bold text-danger">{error}</p>{/if}

		{#if !connected}
			{#if !consent}
				<Button onclick={connect} disabled={busy}>Connect Google Photos</Button>
			{:else}
				<p class="text-body">
					1. Open
					<a class="font-bold underline" href={consent.url} target="_blank" rel="noopener"
						>Google's sign-in</a
					>
					and choose Allow. The page that opens will fail to load: that is expected.
				</p>
				<label class="flex flex-col gap-2 text-body font-bold">
					2. Paste that page's address here
					<input bind:value={pasted} autocomplete="off" spellcheck="false" class={field} />
				</label>
				<Button onclick={finish} disabled={busy || !pasted}>Finish connecting</Button>
			{/if}
		{:else if !active && job?.status !== 'done'}
			{#if folders.length === 0}
				<p class="text-body text-ink-muted">Add a photo folder below first.</p>
			{:else}
				<label class="flex flex-col gap-2 text-body font-bold">
					Photo folder
					<select bind:value={sourceId} class={field}>
						{#each folders as f (f.id)}<option value={f.id}>{f.label}</option>{/each}
					</select>
				</label>
				<label class="flex flex-col gap-2 text-body font-bold">
					Album name
					<input
						bind:value={album}
						placeholder="Google Photos import (today's date)"
						autocomplete="off"
						class={field}
					/>
				</label>
				<Button onclick={start} disabled={busy}>Start import</Button>
			{/if}
		{/if}

		{#if job}
			<div class="flex flex-col gap-2" data-testid="import-job" aria-live="polite">
				{#if job.status === 'waiting'}
					<p class="text-body">
						Open the picker on your phone and choose photos:
						<a
							class="font-bold break-all underline"
							href={job.pickerUri}
							target="_blank"
							rel="noopener">{job.pickerUri}</a
						>
					</p>
					<p class="text-caption text-ink-muted">
						Send this link to your phone (no QR code here yet). Waiting for your pick…
					</p>
				{:else if job.status === 'importing'}
					<p class="text-body font-bold" data-testid="import-progress">
						{job.done + job.skipped + job.failed} of {job.total} photos
					</p>
				{:else if job.status === 'done'}
					<p class="text-body font-bold" data-testid="import-done">
						Done: {job.done} new, {job.skipped} already there, in "{job.album}".
					</p>
				{:else if job.status === 'cancelled'}
					<p class="text-body">Import cancelled.</p>
				{/if}
				{#if job.message}<p class="text-caption text-ink-muted">{job.message}</p>{/if}
				{#if active}<Button onclick={cancel}>Cancel</Button>{/if}
				{#if job.status === 'done' || job.status === 'error' || job.status === 'cancelled'}
					<Button onclick={() => (job = null)}>Import more</Button>
				{/if}
			</div>
		{/if}
	</div>
</Card>
