<script lang="ts">
	import { untrack } from 'svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import { looksLikeGoogleAddress } from '#lib/domain/calendar-health.js';
	import { api } from './api.js';
	import { field, GUIDE_BASE, type Source } from './types.js';

	type Provider = 'google' | 'icloud' | 'ics';
	interface Props {
		/** Present when reconnecting an existing connection. */
		reconnect?: Source | null;
		ondone: (source: Source) => void | Promise<void>;
		oncancel: () => void;
	}
	let { reconnect = null, ondone, oncancel }: Props = $props();

	let provider = $state<Provider | null>(untrack(() => reconnect?.provider ?? null));
	let googleStep = $state<1 | 2>(1);
	let label = $state('');
	let url = $state('');
	let appleId = $state('');
	let appPassword = $state('');
	let pasted = $state('');
	let consent = $state<{ url: string; state: string } | null>(null);
	let busy = $state(false);
	let message = $state('');

	const back = () => {
		message = '';
		googleStep = 1;
		consent = null;
		if (reconnect || !provider) oncancel();
		else provider = null;
	};

	async function finish(res: { ok: boolean; data: Source | null; message: string }) {
		busy = false;
		if (!res.ok || !res.data) {
			message = res.message;
			return;
		}
		await ondone(res.data);
	}

	async function startGoogle() {
		busy = true;
		message = '';
		const res = await api<{ url: string; state: string }>('/api/calendar/google/start', 'POST');
		busy = false;
		if (!res.ok || !res.data) {
			message = res.message;
			return;
		}
		consent = res.data;
		googleStep = 2;
		window.open(res.data.url, '_blank', 'noopener');
	}

	async function finishGoogle() {
		if (!looksLikeGoogleAddress(pasted)) {
			message = 'That does not look like the address. It should contain "code=".';
			return;
		}
		busy = true;
		message = '';
		await finish(
			await api<Source>('/api/calendar/google/finish', 'POST', {
				pasted: pasted.trim(),
				state: consent?.state,
				label: label.trim() || undefined,
				sourceId: reconnect?.id
			})
		);
	}

	async function submitIcloud() {
		busy = true;
		message = '';
		if (reconnect) {
			const res = await api<Source>(`/api/calendar/sources/${reconnect.id}`, 'PATCH', {
				appPassword
			});
			if (res.ok) await api('/api/calendar/sync', 'POST');
			return finish(res);
		}
		await finish(
			await api<Source>('/api/calendar/sources', 'POST', {
				provider: 'icloud',
				label: label.trim(),
				appleId: appleId.trim(),
				appPassword
			})
		);
	}

	async function submitIcs() {
		busy = true;
		message = '';
		await finish(
			await api<Source>('/api/calendar/sources', 'POST', {
				provider: 'ics',
				label: label.trim(),
				url: url.trim()
			})
		);
	}

	const choice =
		'press flex min-h-tap-kid w-full cursor-pointer items-center gap-6 rounded-card bg-surface-raised p-6 text-left shadow-raised active:scale-95';
	const hint = 'text-caption text-ink-muted';
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -->

<Card elevation="float" data-testid="add-connection">
	<div class="flex flex-col gap-6">
		{#if !provider}
			<h2 class="text-title font-extrabold">What kind of calendar?</h2>
			<ul class="flex flex-col gap-4">
				{#each [{ id: 'google', emoji: '📅', title: 'Google', line: 'Gmail or Google Workspace calendars.' }, { id: 'icloud', emoji: '☁️', title: 'iCloud', line: 'Apple calendars.' }, { id: 'ics', emoji: '🔗', title: 'Subscription link', line: 'School, sports teams, holidays: any calendar with a link.' }] as c (c.id)}
					<li>
						<button type="button" class={choice} onclick={() => (provider = c.id as Provider)}>
							<span class="text-display leading-none" aria-hidden="true">{c.emoji}</span>
							<span class="flex flex-col gap-1">
								<span class="text-title font-bold">{c.title}</span>
								<span class="text-body text-ink-muted">{c.line}</span>
							</span>
						</button>
					</li>
				{/each}
			</ul>
		{:else if provider === 'google'}
			{#if googleStep === 1}
				<h2 class="text-title font-extrabold">
					{reconnect ? `Reconnect ${reconnect.label}` : 'Connect Google'}
				</h2>
				<p class="text-body">
					Google needs a one-time setup by a grown-up: a free Google Cloud project, about 10
					minutes. If that is already done, go ahead.
				</p>
				<a
					href="{GUIDE_BASE}/google-calendar.md"
					target="_blank"
					rel="noopener"
					class="inline-flex min-h-tap items-center text-body font-bold text-accent underline"
					>Read the Google setup guide</a
				>
				{#if !reconnect}
					<label class="flex flex-col gap-2 text-caption text-ink-muted">
						Name this calendar
						<input
							bind:value={label}
							placeholder="Mom's Google"
							autocomplete="off"
							class={field}
							aria-label="Name this calendar"
						/>
					</label>
				{/if}
				<p class={hint}>
					A Google page opens in a new tab. Sign in and tap Allow. Then come back here.
				</p>
				<div class="flex flex-wrap gap-4">
					<Button onclick={startGoogle} disabled={busy}>{busy ? 'Opening…' : 'Connect'}</Button>
					<Button variant="secondary" onclick={back}>Back</Button>
				</div>
			{:else}
				<h2 class="text-title font-extrabold">Paste the address you landed on</h2>
				<p class="text-body">
					After you tap Allow, Google shows a page that says <strong
						>"This site can't be reached"</strong
					>. That is expected. Copy the whole web address from the top of that page and paste it
					here.
				</p>
				<label class="flex flex-col gap-2 text-caption text-ink-muted">
					Address
					<textarea
						bind:value={pasted}
						rows="4"
						spellcheck="false"
						autocapitalize="off"
						aria-label="Address you landed on"
						placeholder="http://127.0.0.1:9004/?state=…&code=4/0A…"
						class="{field} py-3"></textarea>
				</label>
				<p class={hint}>
					It looks like: <code class="break-all text-ink"
						>http://127.0.0.1:9004/?state=abc123&amp;code=4/0AbCdEf…&amp;scope=…</code
					>
				</p>
				{#if consent}
					<a
						href={consent.url}
						target="_blank"
						rel="noopener"
						class="inline-flex min-h-tap items-center text-body font-bold text-accent underline"
						>Google did not open? Tap here to open it again</a
					>
				{/if}
				{#if message}<p role="alert" class="text-body font-bold text-danger">{message}</p>{/if}
				<div class="flex flex-wrap gap-4">
					<Button onclick={finishGoogle} disabled={busy || !pasted.trim()}
						>{busy ? 'Connecting…' : 'Finish'}</Button
					>
					<Button variant="secondary" onclick={back}>Back</Button>
				</div>
			{/if}
		{:else if provider === 'icloud'}
			<h2 class="text-title font-extrabold">
				{reconnect ? `Reconnect ${reconnect.label}` : 'Connect iCloud'}
			</h2>
			{#if reconnect}
				<p class="text-body">
					Apple stopped accepting the saved password for {reconnect.account ?? 'this account'}. Make
					a new app-specific password and enter it below.
				</p>
			{:else}
				<label class="flex flex-col gap-2 text-caption text-ink-muted">
					Name this calendar
					<input
						bind:value={label}
						placeholder="Dad's iCloud"
						autocomplete="off"
						class={field}
						aria-label="Name this calendar"
					/>
				</label>
				<label class="flex flex-col gap-2 text-caption text-ink-muted">
					Apple ID (the email you sign in with)
					<input
						bind:value={appleId}
						type="email"
						autocomplete="off"
						autocapitalize="off"
						aria-label="Apple ID"
						class={field}
					/>
				</label>
			{/if}
			<label class="flex flex-col gap-2 text-caption text-ink-muted">
				App-specific password
				<input
					bind:value={appPassword}
					type="password"
					autocomplete="off"
					placeholder="abcd-efgh-ijkl-mnop"
					aria-label="App-specific password"
					class={field}
				/>
			</label>
			<details class="rounded-control bg-surface-sunken p-4">
				<summary class="min-h-tap cursor-pointer py-3 text-body font-bold"
					>How do I get this?</summary
				>
				<ol class="flex list-decimal flex-col gap-2 pl-8 text-body">
					<li>Sign in at appleid.apple.com.</li>
					<li>
						Open <strong>Sign-In and Security</strong>, then
						<strong>App-Specific Passwords</strong>.
					</li>
					<li>Tap <strong>Generate</strong>, name it "Home Hub", and copy the password.</li>
				</ol>
				<p class="{hint} mt-3">
					This is not your normal Apple password, and that one is never needed. Two-factor
					authentication must be on.
				</p>
				<a
					href="{GUIDE_BASE}/icloud-calendar.md"
					target="_blank"
					rel="noopener"
					class="inline-flex min-h-tap items-center text-body font-bold text-accent underline"
					>Full iCloud guide</a
				>
			</details>
			{#if message}<p role="alert" class="text-body font-bold text-danger">{message}</p>{/if}
			<div class="flex flex-wrap gap-4">
				<Button
					onclick={submitIcloud}
					disabled={busy ||
						!appPassword.trim() ||
						(!reconnect && (!appleId.trim() || !label.trim()))}
					>{busy ? 'Checking…' : reconnect ? 'Reconnect' : 'Connect'}</Button
				>
				<Button variant="secondary" onclick={back}>Back</Button>
			</div>
		{:else}
			<h2 class="text-title font-extrabold">Add a subscription link</h2>
			<p class="text-body">
				Many schools, teams and apps give you a calendar link. Paste it here. Links that start with
				<strong>webcal://</strong> work too.
			</p>
			<label class="flex flex-col gap-2 text-caption text-ink-muted">
				Name this calendar
				<input
					bind:value={label}
					placeholder="School"
					autocomplete="off"
					class={field}
					aria-label="Name this calendar"
				/>
			</label>
			<label class="flex flex-col gap-2 text-caption text-ink-muted">
				Link
				<input
					bind:value={url}
					inputmode="url"
					autocomplete="off"
					autocapitalize="off"
					spellcheck="false"
					placeholder="webcal://example.com/school.ics"
					aria-label="Calendar link"
					class={field}
				/>
			</label>
			{#if message}<p role="alert" class="text-body font-bold text-danger">{message}</p>{/if}
			<div class="flex flex-wrap gap-4">
				<Button onclick={submitIcs} disabled={busy || !url.trim() || !label.trim()}
					>{busy ? 'Checking…' : 'Add'}</Button
				>
				<Button variant="secondary" onclick={back}>Back</Button>
			</div>
		{/if}
	</div>
</Card>
