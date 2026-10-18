<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';

	/** Settings > Music > Speaker (hub-txj.1): the Pi's Bluetooth speaker, via /api/music/speaker. */
	type State = 'not_configured' | 'unreachable' | 'none' | 'not_paired' | 'off' | 'connected';
	interface Status {
		state: State;
		name: string | null;
		mac: string | null;
		defaultSink: boolean;
	}
	interface Device {
		mac: string;
		name: string;
		kind: 'speaker' | 'phone' | 'other';
		bars: number;
		paired: boolean;
		connected: boolean;
	}

	let status = $state<Status | null>(null);
	let devices = $state<Device[] | null>(null);
	let scanning = $state(false);
	let pairing = $state<string | null>(null);
	let testing = $state(false);
	let message = $state('');
	let error = $state('');

	const label = $derived(status?.name ?? status?.mac ?? 'The speaker');
	const STATE_TEXT: Record<State, (name: string) => string> = {
		not_configured: () => 'The hub is not set up to reach the wall display',
		unreachable: () => 'The wall display did not answer',
		none: () => 'No speaker yet',
		not_paired: (n) => `${n} is not paired`,
		off: (n) => `${n} is off or out of range`,
		connected: (n) => `Connected to ${n}`
	};

	async function errorOf(res: Response) {
		const body = await res.json().catch(() => null);
		return (body as { message?: string } | null)?.message ?? 'Something went wrong. Try again.';
	}

	async function refresh() {
		const res = await fetch('/api/music/speaker');
		status = res.ok
			? await res.json()
			: { state: 'unreachable', name: null, mac: null, defaultSink: false };
	}

	onMount(refresh);

	async function scan() {
		scanning = true;
		devices = null;
		error = message = '';
		const res = await fetch('/api/music/speaker/scan', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{}'
		});
		scanning = false;
		if (res.ok) devices = await res.json();
		else error = await errorOf(res);
	}

	async function use(d: Device) {
		pairing = d.mac;
		error = message = '';
		const res = await fetch('/api/music/speaker/use', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ mac: d.mac })
		});
		pairing = null;
		if (res.ok) {
			status = await res.json();
			devices = null;
		} else error = await errorOf(res);
	}

	async function test() {
		testing = true;
		error = message = '';
		const res = await fetch('/api/music/speaker/test', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{}'
		});
		testing = false;
		if (res.ok) message = 'Played a chime. Did you hear it?';
		else error = await errorOf(res);
	}
</script>

<Card class="flex flex-col gap-4" data-testid="music-speaker">
	<h2 class="text-lead font-bold">Speaker</h2>
	{#if !status}
		<p class="text-body text-ink-muted">Checking the speaker...</p>
	{:else}
		<p class="text-body font-bold" data-testid="speaker-state">{STATE_TEXT[status.state](label)}</p>
		{#if status.state === 'not_configured'}
			<p class="text-body text-ink-muted">
				Set <code>HUB_KIOSK_SPEAKER_URL</code> (the wall display, port 8742) and
				<code>HUB_KIOSK_SPEAKER_TOKEN</code> (from <code>/etc/hub-kiosk/speaker-api.token</code> on the
				Pi) in the hub .env, then restart the hub.
			</p>
		{:else if status.state === 'connected' && !status.defaultSink}
			<p class="text-body text-ink-muted">Connected, but not chosen for sound yet. Try again.</p>
		{:else if status.state === 'off'}
			<p class="text-body text-ink-muted">Switch it on. The wall display reconnects by itself.</p>
		{/if}

		{#if status.state !== 'not_configured'}
			<div class="flex flex-wrap gap-3">
				<Button variant="secondary" onclick={scan} disabled={scanning} data-testid="speaker-scan">
					{scanning ? 'Looking...' : status.mac ? 'Change speaker' : 'Find a speaker'}
				</Button>
				{#if status.state === 'connected'}
					<Button variant="secondary" onclick={test} disabled={testing} data-testid="speaker-test">
						{testing ? 'Playing...' : 'Test sound'}
					</Button>
				{/if}
			</div>
		{/if}

		{#if scanning}
			<p class="text-body text-ink-muted" role="status">
				Looking for speakers nearby. This takes about 10 seconds. Put a new speaker in pairing mode
				now.
			</p>
		{/if}
		{#if message}<p class="text-body" role="status">{message}</p>{/if}
		{#if error}<p class="text-danger" role="alert">{error}</p>{/if}

		{#if devices}
			{#if devices.length === 0}
				<p class="text-body text-ink-muted">
					Nothing found. Put the speaker in pairing mode, bring it closer, and look again.
				</p>
			{/if}
			<ul class="flex flex-col gap-3" data-testid="speaker-devices">
				{#each devices as d (d.mac)}
					<li class="flex items-center gap-4">
						<span class="flex h-6 items-end gap-1" aria-label="Signal {d.bars} of 4" role="img">
							{#each [1, 2, 3, 4] as bar (bar)}
								<span
									class="w-1.5 rounded-chip {d.bars >= bar ? 'bg-ink' : 'bg-line'} {[
										'h-2',
										'h-3',
										'h-4',
										'h-6'
									][bar - 1]}"
								></span>
							{/each}
						</span>
						<span class="min-w-0 flex-1 truncate text-body font-bold">{d.name}</span>
						{#if d.kind === 'phone'}
							<span class="text-caption text-ink-muted">Not a speaker</span>
						{:else if d.mac === status.mac && status.state === 'connected'}
							<span class="text-caption text-ink-muted">In use</span>
						{:else}
							<Button onclick={() => use(d)} disabled={pairing !== null} data-testid="speaker-use">
								{pairing === d.mac ? 'Connecting...' : 'Use this'}
							</Button>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</Card>
