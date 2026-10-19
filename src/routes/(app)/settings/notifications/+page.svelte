<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import { DEFAULT_NOTIFY, type NotifyConfig } from '#lib/domain/notify.js';

	type Last = { ok: boolean; at: number; detail: string };
	type View = NotifyConfig & { tokenSaved: boolean; last: Last | null };
	const API = '/api/settings/notifications';
	const json = { 'content-type': 'application/json' };

	let cfg = $state<NotifyConfig>({ ...DEFAULT_NOTIFY });
	let token = $state('');
	let tokenSaved = $state(false);
	let last = $state<Last | null>(null);
	let message = $state('');

	function apply({ tokenSaved: saved, last: l, ...c }: View) {
		cfg = c;
		tokenSaved = saved;
		last = l;
	}

	// Each edit stamps a number, so a late load can't overwrite what the adult already changed.
	let edits = 0;

	onMount(async () => {
		const at = edits;
		const res = await fetch(API).catch(() => null);
		if (!res?.ok) return;
		const view = (await res.json()) as View;
		if (at === edits) apply(view);
		else {
			tokenSaved = view.tokenSaved;
			last = view.last;
		}
	});

	/** Saves the page (the token only when typed), then optionally sends a test. */
	async function run(test: boolean) {
		const body = JSON.stringify(token ? { ...cfg, token } : cfg);
		const res = await fetch(API, { method: 'PUT', headers: json, body }).catch(() => null);
		if (res?.ok) {
			apply((await res.json()) as View);
			token = '';
			message = 'Saved.';
			if (test) {
				const sent = await fetch(API, { method: 'POST', headers: json, body: '{}' }).catch(
					() => null
				);
				if (sent?.ok) last = (await sent.json()) as Last;
				else message = 'Could not send the test.';
			}
		} else {
			message =
				((await res?.json().catch(() => null)) as { message?: string } | null)?.message ??
				'Could not save. Try again.';
		}
	}

	const fields = [
		['serverUrl', 'ntfy server'],
		['topic', 'Topic (anyone who knows it can read it, so make it long)'],
		['baseUrl', 'Hub address, optional (lets a tap open the hub)']
	] as const;
	const toggles = [
		['approval', 'Approval waiting'],
		['goal', 'Goal reached'],
		['redeemed', 'Reward redeemed'],
		['streak', 'Streak milestone'],
		['sitter', 'Sitter check-ins and sessions']
	] as const;
	const plain = { autocomplete: 'off', autocapitalize: 'off', spellcheck: false } as const;
	const input = 'min-h-tap rounded-control border-2 border-line bg-surface px-4 text-body text-ink';
</script>

<svelte:head>
	<title>Notifications · Settings · Home Hub</title>
</svelte:head>

<section class="mx-auto flex w-full max-w-4xl flex-col gap-8 p-8 max-sm:p-3">
	<h1 class="text-headline font-extrabold">Notifications</h1>
	<Card>
		<div class="flex flex-col gap-6">
			<div class="flex flex-wrap items-center justify-between gap-6">
				<h2 class="text-title font-bold">Push to grown-ups with ntfy</h2>
				<Button
					variant={cfg.enabled ? 'primary' : 'secondary'}
					aria-pressed={cfg.enabled}
					data-testid="notify-enabled"
					onclick={() => {
						edits++;
						cfg.enabled = !cfg.enabled;
					}}>{cfg.enabled ? 'On' : 'Off'}</Button
				>
			</div>
			{#each fields as [key, title] (key)}
				<label class="flex flex-col gap-2 text-body font-bold">
					{title}
					<input
						bind:value={cfg[key]}
						oninput={() => edits++}
						data-testid="notify-{key}"
						{...plain}
						class={input}
					/>
				</label>
			{/each}
			<label class="flex flex-col gap-2 text-body font-bold">
				Access token, optional
				<input
					bind:value={token}
					type="password"
					autocomplete="off"
					placeholder={tokenSaved ? 'saved' : ''}
					data-testid="notify-token"
					class={input}
				/>
			</label>
		</div>
	</Card>
	<Card>
		<div class="flex flex-col gap-6">
			<h2 class="text-title font-bold">What to send</h2>
			{#each toggles as [key, title] (key)}
				<div class="flex flex-wrap items-center justify-between gap-6">
					<h3 class="text-body font-bold">{title}</h3>
					<Button
						variant={cfg.events[key] ? 'primary' : 'secondary'}
						aria-pressed={cfg.events[key]}
						aria-label={title}
						data-testid="notify-event-{key}"
						onclick={() => {
							edits++;
							cfg.events[key] = !cfg.events[key];
						}}>{cfg.events[key] ? 'On' : 'Off'}</Button
					>
				</div>
			{/each}
		</div>
	</Card>
	<div class="flex flex-wrap gap-4">
		<Button data-testid="notify-save" onclick={() => run(false)}>Save</Button>
		<Button variant="secondary" data-testid="notify-test" onclick={() => run(true)}
			>Send test</Button
		>
	</div>
	{#if message}<p role="status" class="text-body text-ink-muted" data-testid="notify-message">
			{message}
		</p>{/if}
	{#if last}
		<p class="text-body {last.ok ? 'text-ink-muted' : 'text-danger'}" data-testid="notify-last">
			Last send: {last.detail} at {new Date(last.at).toLocaleString()}
		</p>
	{/if}
</section>
