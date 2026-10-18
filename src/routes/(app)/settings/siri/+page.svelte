<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { buildGuide } from '#lib/domain/siri-guide.js';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import { SCOPE_LABELS, SIRI_SCOPES, TOKEN_NAME_MAX, type SiriScope } from '#lib/domain/siri.js';

	interface Token {
		id: string;
		name: string;
		scopes: SiriScope[];
		createdAt: number;
		lastUsedAt: number | null;
	}

	const JSON_HEADERS = { 'content-type': 'application/json' };
	const when = (ms: number) =>
		new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

	let tokens = $state<Token[]>([]);
	let loaded = $state(false);
	let message = $state('');
	let creating = $state(false);
	let name = $state('');
	let picked = $state<SiriScope[]>([...SIRI_SCOPES]);
	/** The just-created secret: held in memory only, shown once. */
	let secret = $state('');
	let copied = $state(false);
	/** Which guide copy button was last pressed (label key). */
	let copiedKey = $state('');
	let guideToken = $state('');
	const guide = $derived(buildGuide(page.url.origin, guideToken || null));

	async function copyValue(key: string, value: string) {
		try {
			await navigator.clipboard.writeText(value);
			copiedKey = key;
		} catch {
			message = 'Could not copy. Press and hold the text to select it.';
		}
	}

	async function load() {
		const res = await fetch('/api/api-tokens');
		tokens = res.ok ? await res.json() : [];
		loaded = true;
	}
	onMount(load);

	function toggle(s: SiriScope) {
		picked = picked.includes(s) ? picked.filter((x) => x !== s) : [...picked, s];
	}

	async function create(e: SubmitEvent) {
		e.preventDefault();
		message = '';
		const res = await fetch('/api/api-tokens', {
			method: 'POST',
			headers: JSON_HEADERS,
			body: JSON.stringify({ name, scopes: picked })
		});
		const body = await res.json().catch(() => null);
		if (!res.ok) {
			message = body?.message ?? 'Could not create the token';
			return;
		}
		secret = body.token;
		guideToken = body.token;
		copied = false;
		creating = false;
		name = '';
		await load();
	}

	async function copy() {
		try {
			await navigator.clipboard.writeText(secret);
			copied = true;
		} catch {
			message = 'Could not copy. Press and hold the token to select it.';
		}
	}

	async function revoke(t: Token) {
		tokens = tokens.filter((x) => x.id !== t.id);
		await fetch(`/api/api-tokens/${t.id}`, { method: 'DELETE', headers: JSON_HEADERS, body: '{}' });
		await load();
	}

	const field =
		'min-h-tap w-full rounded-control border-2 border-line bg-surface px-6 text-body text-ink';
</script>

<svelte:head><title>Siri and Shortcuts settings</title></svelte:head>

<section class="mx-auto flex w-full max-w-5xl flex-col gap-8 p-8 max-sm:p-3 short:gap-4 short:p-3">
	<header class="flex flex-wrap items-center justify-between gap-6">
		<h1 class="text-headline font-extrabold">Siri and Shortcuts</h1>
		<Button
			data-testid="new-token"
			onclick={() => {
				creating = true;
				secret = '';
				guideToken = '';
				message = '';
			}}>New token</Button
		>
	</header>
	<p class="text-body text-ink-muted">
		Each phone gets its own token. A Shortcut on that phone uses it to add list items and Star Jobs
		by voice. Revoke a token if a phone is lost.
	</p>

	{#if secret}
		<Card elevation="float" class="flex flex-col gap-4" data-testid="token-secret-card">
			<p class="text-lead font-bold">Copy this token now</p>
			<p class="text-body text-ink-muted">
				You'll paste this into the Shortcut. It is shown only once; if you lose it, revoke it and
				make a new one.
			</p>
			<code class="text-body break-all select-all" data-testid="token-secret">{secret}</code>
			<div class="flex gap-4">
				<Button data-testid="token-copy" onclick={copy}>{copied ? 'Copied' : 'Copy'}</Button>
				<Button
					variant="secondary"
					data-testid="token-done"
					onclick={() => {
						secret = '';
						guideToken = '';
					}}>Done</Button
				>
			</div>
		</Card>
	{/if}

	{#if creating}
		<Card elevation="float">
			<form class="flex flex-col gap-6" onsubmit={create} data-testid="token-form">
				<label class="flex flex-col gap-2">
					<span class="text-caption text-ink-muted">Name (for example, Dad's iPhone)</span>
					<input
						class={field}
						bind:value={name}
						maxlength={TOKEN_NAME_MAX}
						required
						data-testid="token-name"
					/>
				</label>
				<fieldset class="flex flex-col gap-2">
					<legend class="text-caption text-ink-muted">What it may do</legend>
					{#each SIRI_SCOPES as s (s)}
						<label class="flex min-h-tap items-center gap-4 text-body">
							<input
								type="checkbox"
								class="size-tap"
								checked={picked.includes(s)}
								onchange={() => toggle(s)}
								data-testid="scope-{s}"
							/>
							{SCOPE_LABELS[s]}
						</label>
					{/each}
				</fieldset>
				<div class="flex gap-4">
					<Button type="submit" data-testid="token-create" disabled={picked.length === 0}
						>Create</Button
					>
					<Button variant="secondary" onclick={() => (creating = false)}>Cancel</Button>
				</div>
			</form>
		</Card>
	{/if}
	{#if message}<p class="text-danger" role="alert">{message}</p>{/if}

	<details class="group" open={!!secret} data-testid="siri-guide">
		<summary class="flex min-h-tap cursor-pointer items-center text-lead font-bold">
			How to set up Siri
		</summary>
		<div class="mt-4 flex flex-col gap-6">
			<p class="text-body text-ink-muted">
				{guideToken
					? 'Your new token is filled in below. Copy each value into the matching Shortcut action.'
					: 'Paste the token you saved where the header value says so.'}
				This works on home Wi-Fi only until remote access exists. In the Shortcuts app, tap + to make
				a new Shortcut, name it as shown, then add these actions in order. Siri runs a Shortcut when you
				say its name.
			</p>
			{#each guide as sc (sc.id)}
				<Card class="flex flex-col gap-4" data-testid="guide-{sc.id}">
					<p class="text-lead font-bold">{sc.name}</p>
					<p class="text-caption text-ink-muted">Say: "Hey Siri, {sc.phrase}"</p>
					<ol class="flex list-decimal flex-col gap-4 ps-8 text-body">
						{#each sc.steps as step, i (i)}
							<li>
								<span class="font-bold">{step.action}</span>
								<span class="text-ink-muted"> {step.detail}</span>
								{#if step.copy}
									<div class="mt-2 flex flex-wrap gap-4">
										{#each step.copy as c (c.label)}
											<Button
												variant="secondary"
												data-testid="guide-copy"
												data-value={c.value}
												onclick={() => copyValue(`${sc.id}-${i}-${c.label}`, c.value)}
												>{copiedKey === `${sc.id}-${i}-${c.label}` ? 'Copied' : c.label}</Button
											>
										{/each}
									</div>
									<code class="mt-2 block text-caption break-all select-all"
										>{step.copy.map((c) => c.value).join('  ·  ')}</code
									>
								{/if}
							</li>
						{/each}
					</ol>
				</Card>
			{/each}
		</div>
	</details>

	{#if loaded && tokens.length === 0}
		<p class="text-lead text-ink-muted">No tokens yet. Make one for each phone.</p>
	{/if}

	<ul class="flex flex-col gap-4">
		{#each tokens as t (t.id)}
			<li data-testid="token-row">
				<Card class="flex flex-wrap items-center gap-4 !p-6 max-sm:!p-4">
					<span class="flex min-w-48 flex-1 flex-col">
						<span class="text-lead font-bold">{t.name}</span>
						<span class="text-caption text-ink-muted">
							{t.scopes.map((s) => SCOPE_LABELS[s]).join(', ')}
						</span>
						<span class="text-caption text-ink-muted">
							Made {when(t.createdAt)} · {t.lastUsedAt
								? `last used ${when(t.lastUsedAt)}`
								: 'never used'}
						</span>
					</span>
					<Button
						variant="danger"
						onclick={() => revoke(t)}
						aria-label="Revoke {t.name}"
						data-testid="token-revoke">Revoke</Button
					>
				</Card>
			</li>
		{/each}
	</ul>
</section>
