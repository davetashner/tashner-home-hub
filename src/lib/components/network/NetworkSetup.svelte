<script lang="ts">
	import Card from '#lib/components/ui/Card.svelte';
	import { deviceId, type DeviceView } from '#lib/domain/net-layout.js';
	import type { NetDevice } from '#lib/domain/lan-monitor.js';

	interface Props {
		devices: DeviceView[];
		/** Called after a successful save or import so the page reloads the view. */
		onchange: () => void;
	}
	let { devices, onchange }: Props = $props();

	interface Row {
		id: string;
		name: string;
		ip: string;
		/** 0 means "Nest Wifi status page"; anything else is a TCP port. */
		port: number;
	}
	const toRow = (d: NetDevice): Row => ({
		id: d.id,
		name: d.name,
		ip: d.ip,
		port: d.probe.kind === 'nest' ? 0 : d.probe.port
	});
	let rows = $state<Row[]>([]);
	let open = $state(false);
	let message = $state('');
	let planMessage = $state('');

	function start() {
		rows = devices.map(toRow);
		fresh = [];
		message = '';
		open = true;
	}
	/** Opens the editor with a new row for a host found on the network, ready to name. */
	export function addHost(ip: string, port: number) {
		if (!open) start();
		const id = deviceId('new', [...rows.map((r) => r.id), ...fresh]);
		fresh = [...fresh, id];
		rows.push({ id, name: '', ip, port });
		message = 'Name it, then save.';
	}
	/** Ids of rows added in this edit: they're renamed from their names on save. */
	let fresh: string[] = [];
	function add() {
		const id = deviceId('new', [...rows.map((r) => r.id), ...fresh]);
		fresh = [...fresh, id];
		rows.push({ id, name: '', ip: '', port: 22 });
	}
	async function save() {
		message = 'Saving…';
		// New rows get an id from their name; existing ones keep theirs so placements still match.
		const kept = rows.filter((r) => !fresh.includes(r.id)).map((r) => r.id);
		const list = rows.map((r) => {
			const id = fresh.includes(r.id) ? deviceId(r.name || 'device', kept) : r.id;
			kept.push(id);
			return {
				id,
				name: r.name,
				ip: r.ip.trim(),
				probe: r.port === 0 ? { kind: 'nest' } : { kind: 'tcp', port: r.port }
			};
		});
		const res = await fetch('/api/network', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ devices: list })
		}).catch(() => null);
		if (!res?.ok) {
			message = "Couldn't save. Check you're still unlocked and try again.";
			return;
		}
		const { dropped } = (await res.json()) as { dropped: number };
		message = dropped
			? `Saved. ${dropped} skipped: each needs a name, a home-network IP (like 192.168.1.20) and a check.`
			: 'Saved. The hub checks them every minute.';
		open = dropped > 0;
		onchange();
	}

	let pasted = $state('');
	async function importPlan(e: Event) {
		const file = (e.currentTarget as HTMLInputElement).files?.[0];
		if (file) await sendPlan(await file.text());
	}
	async function sendPlan(text: string) {
		planMessage = 'Importing…';
		let body: unknown;
		try {
			body = JSON.parse(text);
		} catch {
			planMessage = "That file isn't a floor plan. Export it from the plan builder as JSON.";
			return;
		}
		const res = await fetch('/api/network/layout', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		}).catch(() => null);
		if (!res?.ok) {
			planMessage = "That file isn't a floor plan. Export it from the plan builder as JSON.";
			return;
		}
		const plan = (await res.json()) as { rooms: unknown[]; placements: unknown[] };
		planMessage = `Imported ${plan.rooms.length} rooms and ${plan.placements.length} device spots.`;
		pasted = '';
		onchange();
	}

	const field =
		'min-h-tap w-full min-w-0 rounded-control border-2 border-line bg-surface px-4 text-body text-ink';
	const button =
		'min-h-tap rounded-control border-2 border-control-line bg-control px-6 text-body font-bold transition-transform duration-75 active:scale-95';
</script>

<Card class="flex flex-col gap-6" data-testid="net-setup">
	<div class="flex flex-col gap-2">
		<h2 class="text-title font-bold">Floor plan</h2>
		<p class="text-body text-ink-muted">
			Import a plan copied or exported from the plan builder. It replaces the current one. To move a
			device, pick it in the list and tap “Move on the plan”.
		</p>
		<label class="flex flex-col gap-1">
			<span class="text-caption text-ink-muted">Plan file</span>
			<input
				type="file"
				accept="application/json,.json"
				class="min-h-tap text-body"
				onchange={importPlan}
				data-testid="net-import"
			/>
		</label>
		<label class="flex flex-col gap-1">
			<span class="text-caption text-ink-muted">Or paste the plan's JSON</span>
			<textarea class="{field} min-h-tap-kid py-2" bind:value={pasted} data-testid="net-paste"
			></textarea>
		</label>
		<button
			type="button"
			class="{button} self-start"
			disabled={!pasted.trim()}
			onclick={() => sendPlan(pasted)}
			data-testid="net-paste-import">Import pasted plan</button
		>
		{#if planMessage}<p class="text-body" role="status">{planMessage}</p>{/if}
	</div>

	<div class="flex flex-col gap-3">
		<h2 class="text-title font-bold">Devices</h2>
		{#if !open}
			<button
				type="button"
				class="{button} self-start"
				onclick={start}
				data-testid="net-edit-devices">Edit the device list</button
			>
		{:else}
			<p class="text-body text-ink-muted">
				Pick “Nest Wifi” for the router and points. For anything else, give a port it listens on (22
				for a Pi or server, 8060 for a Roku); a refused port still counts as answering.
			</p>
			<ul class="flex flex-col gap-3">
				{#each rows as row, i (row.id)}
					<li class="grid grid-cols-4 items-end gap-3 max-sm:grid-cols-2" data-testid="net-row">
						<label class="flex flex-col gap-1">
							<span class="text-caption text-ink-muted">Name</span>
							<input class={field} bind:value={row.name} data-testid="net-row-name" />
						</label>
						<label class="flex flex-col gap-1">
							<span class="text-caption text-ink-muted">IP address</span>
							<input
								class={field}
								bind:value={row.ip}
								inputmode="decimal"
								data-testid="net-row-ip"
							/>
						</label>
						<label class="flex flex-col gap-1">
							<span class="text-caption text-ink-muted">Check</span>
							<select
								class={field}
								value={row.port === 0 ? 'nest' : 'port'}
								onchange={(e) => (row.port = e.currentTarget.value === 'nest' ? 0 : 22)}
							>
								<option value="nest">Nest Wifi</option>
								<option value="port">Port</option>
							</select>
						</label>
						{#if row.port === 0}
							<button type="button" class={button} onclick={() => rows.splice(i, 1)}>Remove</button>
						{:else}
							<div class="flex gap-3">
								<label class="flex min-w-0 flex-1 flex-col gap-1">
									<span class="text-caption text-ink-muted">Port</span>
									<input class={field} type="number" min="1" max="65535" bind:value={row.port} />
								</label>
								<button
									type="button"
									class="{button} self-end"
									onclick={() => rows.splice(i, 1)}
									aria-label="Remove {row.name || 'device'}">✕</button
								>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
			<div class="flex flex-wrap gap-3">
				<button type="button" class={button} onclick={add} data-testid="net-add"
					>Add a device</button
				>
				<button
					type="button"
					class="min-h-tap rounded-control bg-accent px-6 text-body font-bold text-on-accent transition-transform duration-75 active:scale-95"
					onclick={save}
					data-testid="net-save">Save devices</button
				>
				<button type="button" class={button} onclick={() => (open = false)}>Cancel</button>
			</div>
		{/if}
		{#if message}<p class="text-body" role="status">{message}</p>{/if}
	</div>
</Card>
