<script lang="ts">
	import { onMount } from 'svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import { safeFetch } from '#lib/domain/api-error.js';
	import { domainOf, flipTile, type HaTile } from '#lib/domain/home-assistant.js';

	const POLL_MS = 10_000;
	/** HA takes a moment to report a change; re-read just after a tap to confirm it. */
	const SETTLE_MS = 1_200;

	let tiles = $state<HaTile[]>([]);
	let configured = $state(false);
	let reachable = $state(true);
	let error = $state('');
	let activated = $state('');
	/** Taps in flight: a poll must not overwrite the optimistic state under them. */
	let inflight = 0;

	async function refresh() {
		const res = await safeFetch('/api/home-assistant/tiles');
		if (!res.ok) {
			reachable = false;
			return;
		}
		const body = (await res.json().catch(() => null)) as
			{ configured: false } | { configured: true; reachable: boolean; tiles: HaTile[] } | null;
		if (!body) return;
		configured = body.configured;
		if (!body.configured) return;
		reachable = body.reachable;
		if (inflight === 0) tiles = body.tiles;
	}

	async function tap(tile: HaTile) {
		if (tile.unavailable) return;
		const before = tiles;
		error = '';
		tiles = flipTile(tiles, tile.entityId); // optimistic: the tile flips before the network answers
		if (tile.kind === 'scene') {
			activated = tile.entityId;
			setTimeout(() => (activated = ''), 2000);
		}
		inflight++;
		const res = await safeFetch('/api/home-assistant/toggle', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ entityId: tile.entityId })
		});
		inflight--;
		if (!res.ok) {
			tiles = before;
			activated = '';
			error = `Could not reach ${tile.name}. Try again.`;
			return;
		}
		setTimeout(() => void refresh(), SETTLE_MS);
	}

	onMount(() => {
		void refresh();
		// Poll only while the screen is showing: a dark wall display makes no calls.
		const timer = setInterval(() => {
			if (document.visibilityState === 'visible') void refresh();
		}, POLL_MS);
		const onVisible = () => {
			if (document.visibilityState === 'visible') void refresh();
		};
		document.addEventListener('visibilitychange', onVisible);
		return () => {
			clearInterval(timer);
			document.removeEventListener('visibilitychange', onVisible);
		};
	});

	const ICON = {
		light: '💡',
		switch: '🔌',
		scene: '🎬',
		sensor: '🌡️',
		binary_sensor: '🚪'
	} as const;
	const sensorLabel = (t: HaTile) =>
		t.unavailable ? 'Unavailable' : t.stale ? 'Not updating' : (t.reading ?? '');
	const stateLabel = (t: HaTile) =>
		t.unavailable
			? 'Unavailable'
			: t.kind === 'scene'
				? activated === t.entityId
					? 'Done'
					: 'Scene'
				: t.on === null
					? ''
					: t.on
						? 'On'
						: 'Off';
</script>

{#if configured}
	<section aria-label="Home controls" data-testid="home-controls">
		<Card class="flex flex-col gap-4 short:gap-2 short:p-3">
			<div class="flex items-center justify-between gap-4">
				<h2 class="text-lead font-extrabold short:text-body">Home controls</h2>
				{#if !reachable}
					<p
						role="status"
						data-testid="ha-unreachable"
						class="rounded-control bg-danger-soft px-4 py-1 text-caption font-bold text-danger"
					>
						Home Assistant unreachable
					</p>
				{/if}
			</div>
			<ul class="grid grid-cols-3 gap-4 max-sm:grid-cols-2 portrait:grid-cols-2 short:gap-2">
				{#each tiles as tile (tile.entityId)}
					<li>
						{#if tile.kind === 'sensor' || tile.kind === 'contact'}
							<div
								data-testid="ha-sensor"
								data-entity={tile.entityId}
								data-state={tile.unavailable ? 'unavailable' : tile.stale ? 'stale' : 'ok'}
								data-open={tile.open === null ? undefined : String(tile.open)}
								class="flex min-h-tap-kid w-full flex-col items-center justify-center gap-1 rounded-card border-2 border-line bg-surface p-4 text-center short:p-2 {tile.unavailable ||
								tile.stale
									? 'opacity-45'
									: ''} {tile.open ? 'border-danger' : ''}"
							>
								<span class="text-headline leading-none short:text-title" aria-hidden="true"
									>{ICON[
										domainOf(tile.entityId) === 'binary_sensor' ? 'binary_sensor' : 'sensor'
									]}</span
								>
								<span class="text-body font-extrabold short:text-caption">{tile.name}</span>
								<span class="text-lead font-extrabold short:text-body" data-testid="ha-reading"
									>{sensorLabel(tile)}</span
								>
								{#if tile.stale && tile.reading}
									<span class="text-caption text-ink-muted">Last: {tile.reading}</span>
								{/if}
							</div>
						{:else}
							<button
								type="button"
								data-testid="ha-tile"
								data-entity={tile.entityId}
								data-on={tile.on === null ? undefined : String(tile.on)}
								aria-pressed={tile.kind === 'toggle' && tile.on !== null ? tile.on : undefined}
								disabled={tile.unavailable}
								onclick={() => tap(tile)}
								class="flex min-h-tap-kid w-full flex-col items-center justify-center gap-1 rounded-card border-2 p-4 text-center transition-transform duration-75 active:scale-95 disabled:opacity-45 short:p-2 {tile.on
									? 'border-accent bg-accent-soft'
									: 'border-control-line bg-control'}"
							>
								<span class="text-headline leading-none short:text-title" aria-hidden="true"
									>{ICON[domainOf(tile.entityId) ?? 'switch']}</span
								>
								<span class="text-body font-extrabold short:text-caption">{tile.name}</span>
								<span class="text-caption text-ink-muted">{stateLabel(tile)}</span>
							</button>
						{/if}
					</li>
				{/each}
			</ul>
			{#if error}<p role="alert" class="text-body text-danger">{error}</p>{/if}
		</Card>
	</section>
{/if}
