<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import { DIM_MAX, DIM_MIN, NAME_MAX, type BulbView } from '#lib/domain/wiz.js';

	let lights = $state<BulbView[]>([]);
	let loaded = $state(false);
	let searching = $state(false);
	let message = $state('');

	async function readLights(res: Response | null): Promise<BulbView[] | null> {
		if (!res?.ok) return null;
		return ((await res.json()) as { lights: BulbView[] }).lights;
	}

	onMount(async () => {
		const got = await readLights(await fetch('/api/lights').catch(() => null));
		if (got) lights = got;
		else message = 'Could not load the lights.';
		loaded = true;
	});

	async function search() {
		searching = true;
		message = '';
		const got = await readLights(
			await fetch('/api/lights/search', { method: 'POST' }).catch(() => null)
		);
		searching = false;
		if (got) lights = got;
		else message = 'Could not search for lights. Try again.';
	}

	function patch(mac: string, change: Partial<BulbView>) {
		// Optimistic: the card changes at once and goes back only if the bulb says no.
		const i = lights.findIndex((l) => l.mac === mac);
		if (i < 0) return;
		const before = lights[i];
		lights[i] = { ...before, ...change };
		message = '';
		const fail = async (res: Response | null) => {
			const body = res ? await res.json().catch(() => null) : null;
			message = (body as { message?: string } | null)?.message ?? 'Could not reach that light.';
			const j = lights.findIndex((l) => l.mac === mac);
			if (j >= 0) lights[j] = before;
		};
		void fetch(`/api/lights/${mac}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(change)
		})
			.then((res) => (res.ok ? undefined : fail(res)))
			.catch(() => fail(null));
	}

	function rename(light: BulbView, value: string) {
		const name = value.trim();
		if (name && name !== light.name) patch(light.mac, { name });
	}

	function forget(mac: string) {
		lights = lights.filter((l) => l.mac !== mac);
		void fetch(`/api/lights/${mac}`, { method: 'DELETE' }).catch(() => {});
	}

	const field =
		'min-h-tap w-full rounded-control border-2 border-line bg-surface px-6 text-body text-ink';
</script>

<svelte:head>
	<title>Lights · Settings · Home Hub</title>
</svelte:head>

<section class="mx-auto flex w-full max-w-4xl flex-col gap-8 p-8 max-sm:p-3 short:gap-4 short:p-3">
	<div class="flex flex-wrap items-center justify-between gap-4">
		<h1 class="text-headline font-extrabold">Lights</h1>
		<Button onclick={search} disabled={searching}>
			{searching ? 'Looking…' : 'Find lights'}
		</Button>
	</div>
	<p class="text-body text-ink-muted">
		WiZ bulbs on the home Wi-Fi. They are found and switched over the home network, with no app
		account.
	</p>
	{#if loaded && lights.length === 0}
		<Card>
			<p class="text-body" data-testid="lights-empty">
				No lights yet. Make sure the bulbs are set up in the WiZ app, then tap Find lights.
			</p>
		</Card>
	{/if}
	{#each lights as light (light.mac)}
		<Card>
			<div class="flex flex-col gap-6" data-testid="light">
				<div class="flex flex-wrap items-end justify-between gap-4">
					<label class="flex min-w-0 flex-1 flex-col gap-2">
						<span class="text-caption text-ink-muted">Name</span>
						<input
							class={field}
							value={light.name}
							maxlength={NAME_MAX}
							aria-label="Name of {light.name}"
							onchange={(e) => rename(light, e.currentTarget.value)}
						/>
					</label>
					<Button variant="ghost" onclick={() => forget(light.mac)} aria-label="Forget {light.name}"
						>Forget</Button
					>
				</div>
				{#if light.reachable}
					<div class="flex flex-wrap items-center gap-6">
						<div class="flex gap-4" role="group" aria-label="{light.name} power">
							{#each [true, false] as on (on)}
								<Button
									variant={light.on === on ? 'primary' : 'secondary'}
									aria-pressed={light.on === on}
									onclick={() => light.on !== on && patch(light.mac, { on })}
									>{on ? 'On' : 'Off'}</Button
								>
							{/each}
						</div>
						<input
							type="range"
							min={DIM_MIN}
							max={DIM_MAX}
							step="5"
							value={light.dimming}
							aria-label="{light.name} brightness"
							class="h-tap min-w-tap-kid flex-1 accent-accent"
							onchange={(e) => patch(light.mac, { dimming: e.currentTarget.valueAsNumber })}
						/>
						<output class="min-w-tap text-center text-title font-bold">{light.dimming}%</output>
					</div>
				{:else}
					<p class="text-body text-ink-muted" data-testid="light-offline">
						Not answering. It may be switched off at the wall, or tap Find lights if it moved.
					</p>
				{/if}
			</div>
		</Card>
	{/each}
	{#if message}<p role="alert" class="text-body text-danger">{message}</p>{/if}
</section>
