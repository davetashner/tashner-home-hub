<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import { page } from '$app/state';
	import { errorMessage, safeFetch } from '#lib/domain/api-error.js';
	import { restCommandYaml } from '#lib/domain/ha-display.js';
	import { DISPLAY_SCOPE, type SiriScope } from '#lib/domain/siri.js';
	import {
		fallbackName,
		MAX_TILES,
		moveItem,
		type HaEntity,
		type HaSelection
	} from '#lib/domain/home-assistant.js';

	interface Config {
		configured: boolean;
		baseUrl: string;
		hasToken: boolean;
		tiles: HaSelection[];
	}

	let config = $state<Config | null>(null);
	let baseUrl = $state('');
	let token = $state('');
	let picks = $state<HaSelection[]>([]);
	let entities = $state<HaEntity[] | null>(null);
	let testResult = $state('');
	let testOk = $state(false);
	let error = $state('');
	let entityError = $state('');
	let busy = $state(false);

	interface ScreenToken {
		id: string;
		name: string;
		scopes: SiriScope[];
		lastUsedAt: number | null;
	}
	let screenTokens = $state<ScreenToken[]>([]);
	/** The just-created secret: memory only, shown once. */
	let screenSecret = $state('');
	let screenError = $state('');
	let yamlCopied = $state(false);
	const yaml = $derived(restCommandYaml(page.url.origin, screenSecret || null));

	async function loadScreenTokens() {
		const res = await safeFetch('/api/api-tokens');
		if (res.ok)
			screenTokens = ((await res.json()) as ScreenToken[]).filter((t) =>
				t.scopes.includes(DISPLAY_SCOPE)
			);
	}

	async function makeScreenToken() {
		screenError = '';
		const res = await safeFetch('/api/api-tokens', {
			method: 'POST',
			headers: json,
			body: JSON.stringify({ name: 'Home Assistant screen', scopes: [DISPLAY_SCOPE] })
		});
		if (!res.ok) {
			screenError = await errorMessage(res);
			return;
		}
		screenSecret = ((await res.json()) as { token: string }).token;
		yamlCopied = false;
		await loadScreenTokens();
	}

	async function revokeScreenToken(t: ScreenToken) {
		screenTokens = screenTokens.filter((x) => x.id !== t.id);
		await safeFetch(`/api/api-tokens/${t.id}`, { method: 'DELETE', headers: json, body: '{}' });
		await loadScreenTokens();
	}

	async function copyYaml() {
		try {
			await navigator.clipboard.writeText(yaml);
			yamlCopied = true;
		} catch {
			screenError = 'Could not copy. Press and hold the text to select it.';
		}
	}

	const json = { 'content-type': 'application/json' };
	const field =
		'min-h-tap w-full rounded-control border-2 border-line bg-surface px-6 text-body text-ink';
	const secondary =
		'min-h-tap min-w-tap rounded-control border-2 border-line bg-surface-raised px-6 text-body font-bold transition-transform duration-75 active:scale-95';

	const picked = $derived(new Set(picks.map((p) => p.entityId)));
	const nameOf = (id: string) => entities?.find((e) => e.entityId === id)?.name ?? fallbackName(id);

	// Non-reactive. Once the adult types the address, or saves/removes the connection, the
	// (possibly late) first load must not overwrite what they did.
	let urlTouched = false;
	let changed = false;

	function apply(c: Config) {
		config = c;
		baseUrl = c.baseUrl;
		picks = c.tiles;
	}

	function applyLoaded(c: Config) {
		// The stale load is older than a save/remove: drop it entirely.
		if (changed) return;
		config = c;
		if (!urlTouched) baseUrl = c.baseUrl;
		picks = c.tiles;
	}

	async function loadEntities() {
		entityError = '';
		const res = await safeFetch('/api/settings/home-assistant/entities');
		if (res.ok) entities = ((await res.json()) as { entities: HaEntity[] }).entities;
		else entityError = await errorMessage(res);
	}

	onMount(async () => {
		void loadScreenTokens();
		const res = await safeFetch('/api/settings/home-assistant');
		if (res.ok) {
			applyLoaded((await res.json()) as Config);
			if (config?.configured) void loadEntities();
		}
	});

	async function save() {
		changed = true;
		busy = true;
		error = '';
		const res = await safeFetch('/api/settings/home-assistant', {
			method: 'PUT',
			headers: json,
			body: JSON.stringify({ baseUrl, token })
		});
		busy = false;
		if (!res.ok) {
			error = await errorMessage(res);
			return;
		}
		apply((await res.json()) as Config);
		token = '';
		void loadEntities();
	}

	async function testIt() {
		busy = true;
		testResult = '';
		const res = await safeFetch('/api/settings/home-assistant/test', {
			method: 'POST',
			headers: json,
			body: JSON.stringify({ baseUrl, token })
		});
		busy = false;
		testOk = res.ok;
		testResult = res.ok ? 'Connected to Home Assistant.' : await errorMessage(res);
	}

	async function remove() {
		changed = true;
		const before = config;
		const res = await safeFetch('/api/settings/home-assistant', {
			method: 'DELETE',
			headers: json,
			body: '{}'
		});
		if (!res.ok) {
			config = before;
			error = await errorMessage(res);
			return;
		}
		apply((await res.json()) as Config);
		entities = null;
		token = '';
		testResult = '';
	}

	/** Optimistic: the list changes first; a failed save puts it back. */
	async function persist(next: HaSelection[]) {
		const before = picks;
		picks = next;
		error = '';
		const res = await safeFetch('/api/settings/home-assistant/tiles', {
			method: 'PUT',
			headers: json,
			body: JSON.stringify({ tiles: next })
		});
		if (!res.ok) {
			picks = before;
			error = await errorMessage(res);
		}
	}

	function toggle(e: HaEntity) {
		if (picked.has(e.entityId)) void persist(picks.filter((p) => p.entityId !== e.entityId));
		else if (picks.length < MAX_TILES) void persist([...picks, { entityId: e.entityId, name: '' }]);
	}

	function rename(i: number, name: string) {
		if (picks[i]!.name === name.trim()) return;
		void persist(picks.map((p, j) => (j === i ? { ...p, name: name.trim() } : p)));
	}
</script>

<svelte:head>
	<title>Home Assistant · Settings · Home Hub</title>
</svelte:head>

<section class="mx-auto flex w-full max-w-4xl flex-col gap-8 p-8 max-sm:p-3 short:gap-4 short:p-3">
	<h1 class="text-headline font-extrabold">Home Assistant</h1>

	<Card class="flex flex-col gap-4">
		<p class="text-body text-ink-muted">
			Lights, switches and scenes on the Home screen, plus read-only temperature, humidity and door
			or window sensors. The hub talks to Home Assistant itself, so the token stays on the server.
			Create a long-lived access token on your Home Assistant profile page.
		</p>
		<form
			class="flex flex-col gap-4"
			onsubmit={(e) => {
				e.preventDefault();
				void save();
			}}
		>
			<label class="flex flex-col gap-2">
				<span class="text-caption text-ink-muted">Address</span>
				<input
					class={field}
					type="url"
					inputmode="url"
					autocomplete="off"
					placeholder="http://homeassistant.local:8123"
					data-testid="ha-url"
					oninput={() => (urlTouched = true)}
					bind:value={baseUrl}
				/>
			</label>
			<label class="flex flex-col gap-2">
				<span class="text-caption text-ink-muted">Long-lived access token</span>
				<input
					class={field}
					type="password"
					autocomplete="off"
					placeholder={config?.hasToken ? 'Saved. Leave blank to keep it' : ''}
					data-testid="ha-token"
					bind:value={token}
				/>
			</label>
			<div class="flex flex-wrap gap-3">
				<Button type="submit" disabled={busy} data-testid="ha-save">Save</Button>
				<button
					type="button"
					class={secondary}
					disabled={busy}
					onclick={testIt}
					data-testid="ha-test">Test connection</button
				>
				{#if config?.configured}
					<button type="button" class={secondary} onclick={remove} data-testid="ha-remove"
						>Remove</button
					>
				{/if}
			</div>
		</form>
		{#if testResult}
			<p
				role="status"
				data-testid="ha-test-result"
				class="text-body {testOk ? 'text-success' : 'text-danger'}"
			>
				{testResult}
			</p>
		{/if}
		{#if error}<p role="alert" class="text-body text-danger">{error}</p>{/if}
	</Card>

	<Card class="flex flex-col gap-4" data-testid="ha-screen">
		<h2 class="text-title font-bold">Wake or sleep the screen</h2>
		<p class="text-body text-ink-muted">
			Let a Home Assistant automation wake the wall (a hallway motion sensor) or put it to sleep (a
			goodnight scene). Make a token, then paste the snippet into Home Assistant's
			<code class="break-all">configuration.yaml</code>
			and call <code class="break-all">rest_command.hub_wake_screen</code> or
			<code class="break-all">rest_command.hub_sleep_screen</code> from an automation. The token only
			works for the screen. It is shown once; revoke it here at any time.
		</p>
		<div class="flex flex-wrap gap-3">
			<Button onclick={makeScreenToken} data-testid="ha-screen-new">New screen token</Button>
		</div>
		{#if screenSecret}
			<p class="text-body font-bold">Copy this token now</p>
			<code class="text-body break-all select-all" data-testid="ha-screen-secret"
				>{screenSecret}</code
			>
		{/if}
		<pre
			class="rounded-control border-2 border-line bg-surface p-4 text-caption break-all whitespace-pre-wrap select-all"
			data-testid="ha-screen-yaml">{yaml}</pre>
		<div class="flex flex-wrap gap-3">
			<button type="button" class={secondary} onclick={copyYaml} data-testid="ha-screen-copy"
				>{yamlCopied ? 'Copied' : 'Copy snippet'}</button
			>
		</div>
		{#each screenTokens as t (t.id)}
			<div class="flex flex-wrap items-center gap-3" data-testid="ha-screen-token">
				<span class="min-w-0 flex-1 text-body">
					{t.name}
					<span class="text-caption text-ink-muted"
						>{t.lastUsedAt
							? `last used ${new Date(t.lastUsedAt).toLocaleString()}`
							: 'never used'}</span
					>
				</span>
				<button
					type="button"
					class={secondary}
					aria-label="Revoke {t.name}"
					onclick={() => revokeScreenToken(t)}
					data-testid="ha-screen-revoke">Revoke</button
				>
			</div>
		{/each}
		{#if screenError}<p role="alert" class="text-body text-danger">{screenError}</p>{/if}
	</Card>

	{#if config?.configured}
		<Card class="flex flex-col gap-4">
			<h2 class="text-title font-bold">On the wall</h2>
			{#if picks.length === 0}
				<p class="text-body text-ink-muted">Nothing picked yet. Tick entities below.</p>
			{/if}
			<ul class="flex flex-col gap-3" aria-label="Wall tiles">
				{#each picks as p, i (p.entityId)}
					<li class="flex flex-wrap items-center gap-3" data-testid="ha-pick">
						<input
							class="{field} min-w-0 flex-1"
							aria-label="Name for {nameOf(p.entityId)}"
							placeholder={nameOf(p.entityId)}
							value={p.name}
							maxlength="40"
							onchange={(e) => rename(i, e.currentTarget.value)}
						/>
						<button
							type="button"
							class={secondary}
							aria-label="Move {nameOf(p.entityId)} up"
							disabled={i === 0}
							onclick={() => persist(moveItem(picks, i, -1))}>↑</button
						>
						<button
							type="button"
							class={secondary}
							aria-label="Move {nameOf(p.entityId)} down"
							disabled={i === picks.length - 1}
							onclick={() => persist(moveItem(picks, i, 1))}>↓</button
						>
					</li>
				{/each}
			</ul>
		</Card>

		<Card class="flex flex-col gap-4">
			<h2 class="text-title font-bold">Lights, switches, scenes and sensors</h2>
			{#if entityError}
				<p role="alert" class="text-body text-danger" data-testid="ha-entity-error">
					{entityError}
				</p>
				<button type="button" class="{secondary} self-start" onclick={loadEntities}
					>Try again</button
				>
			{:else if entities === null}
				<p class="text-body text-ink-muted">Loading…</p>
			{:else if entities.length === 0}
				<p class="text-body text-ink-muted">
					Home Assistant has no lights, switches, scenes or sensors to show.
				</p>
			{/if}
			<ul class="flex flex-col gap-3" aria-label="Available entities">
				{#each entities ?? [] as e (e.entityId)}
					<li>
						<button
							type="button"
							role="checkbox"
							aria-checked={picked.has(e.entityId)}
							data-testid="ha-entity"
							data-entity={e.entityId}
							onclick={() => toggle(e)}
							class="flex min-h-tap w-full items-center gap-4 rounded-control border-2 px-6 text-left text-body transition-transform duration-75 active:scale-95 {picked.has(
								e.entityId
							)
								? 'border-accent bg-accent-soft'
								: 'border-line bg-surface-raised'}"
						>
							<span aria-hidden="true" class="font-extrabold"
								>{picked.has(e.entityId) ? '✓' : '○'}</span
							>
							<span class="min-w-0 flex-1 font-bold">{e.name}</span>
							<span class="text-caption text-ink-muted">{e.domain}</span>
						</button>
					</li>
				{/each}
			</ul>
		</Card>
	{/if}
</section>
