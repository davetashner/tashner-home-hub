<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import { errorMessage, safeFetch } from '#lib/domain/api-error.js';
	import {
		describeWallPower,
		parseWallPower,
		type WallPowerState
	} from '#lib/domain/wall-power.js';
	import { parseDisplayRole, type DisplayRole } from '#lib/domain/display-role.js';
	import {
		DEFAULT_IDLE,
		IDLE_SETTINGS_EVENT,
		MAX_IDLE_MINUTES,
		parseIdleSettings,
		type IdleSettings
	} from '#lib/domain/idle.js';
	import {
		DEFAULT_OVERLAY,
		parseOverlaySettings,
		type OverlayField,
		type OverlaySettings
	} from '#lib/domain/frame-overlay.js';
	import {
		DEFAULT_SLIDESHOW,
		INTERVAL_STEPS,
		intervalLabel,
		parseSlideshowSettings,
		stepInterval,
		type LivePhotoMode,
		type SlideshowSettings,
		type Transition
	} from '#lib/domain/slideshow.js';

	import { type OnThisDayMode } from '#lib/domain/on-this-day.js';

	let settings = $state<IdleSettings>({ ...DEFAULT_IDLE });
	let slideshow = $state<SlideshowSettings>({ ...DEFAULT_SLIDESHOW });
	let overlay = $state<OverlaySettings>({ ...DEFAULT_OVERLAY });
	let message = $state('');
	// This device's role; optimistic until the save lands, then the layout data takes over again.
	let pending = $state<DisplayRole | null>(null);
	const role = $derived(pending ?? parseDisplayRole(page.data.displayRole));

	const roles: { value: DisplayRole; label: string; line: string }[] = [
		{
			value: 'personal',
			label: 'Personal',
			line: 'A phone or tablet. Stays on the screen you left it on, stays unlocked.'
		},
		{
			value: 'wall',
			label: 'Wall display',
			line: 'The shared screen. Goes home and shows the photo frame when idle.'
		}
	];

	function changeRole(next: DisplayRole) {
		if (next === role) return;
		message = '';
		pending = next;
		void fetch('/api/display/role', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ role: next })
		})
			.then(async (res) => {
				if (!res.ok) message = 'Could not save. Try again.';
				else await invalidateAll();
			})
			.catch(() => (message = 'Could not save. Try again.'))
			.finally(() => (pending = null));
	}
	// The wall's power, for phones: "Waking…" / "Going to sleep…" while a tap is in flight.
	let wall = $state<WallPowerState | null>(null);
	let wallBusy = $state<'wake' | 'sleep' | null>(null);
	let wallError = $state('');
	const wallText = $derived(
		wallBusy === 'wake'
			? 'Waking…'
			: wallBusy === 'sleep'
				? 'Going to sleep…'
				: wall
					? describeWallPower(wall, page.data.timeZone ?? 'UTC')
					: 'Checking…'
	);

	async function loadWall() {
		const res = await safeFetch('/api/display/power', { cache: 'no-store' });
		const next = res.ok ? parseWallPower(await res.json().catch(() => null)) : null;
		if (next && !wallBusy) wall = next;
	}

	async function wallAction(kind: 'wake' | 'sleep') {
		if (wallBusy) return;
		wallError = '';
		wallBusy = kind;
		const res = await safeFetch(`/api/display/${kind}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{}'
		});
		const next = res.ok ? parseWallPower(await res.json().catch(() => null)) : null;
		if (next) wall = next;
		else wallError = res.ok ? 'Something went wrong.' : await errorMessage(res);
		wallBusy = null;
	}

	// Each save stamps a number, so a stale load can't undo a change made meanwhile.
	let slideshowEdits = 0;
	let overlayEdits = 0;

	onMount(() => {
		void loadWall();
		void fetch('/api/settings/idle')
			.then(async (res) => {
				if (res.ok) settings = parseIdleSettings(await res.json());
			})
			.catch(() => {});
		const edits = slideshowEdits;
		void fetch('/api/settings/slideshow')
			.then(async (res) => {
				const loaded = res.ok ? parseSlideshowSettings(await res.json()) : null;
				if (loaded && edits === slideshowEdits) slideshow = loaded;
			})
			.catch(() => {});
		const overlayAt = overlayEdits;
		void fetch('/api/settings/frame-overlay')
			.then(async (res) => {
				const loaded = res.ok ? parseOverlaySettings(await res.json()) : null;
				if (loaded && overlayAt === overlayEdits) overlay = loaded;
			})
			.catch(() => {});
	});

	function save(url: string, body: Record<string, unknown>) {
		message = '';
		void fetch(url, {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		})
			.then((res) => {
				if (!res.ok) message = 'Could not save. Try again.';
			})
			.catch(() => (message = 'Could not save. Try again.'));
	}

	function changeSlideshow(patch: Partial<SlideshowSettings>) {
		// Optimistic: the screen updates before the save lands; the frame reads it when it starts.
		slideshowEdits++;
		slideshow = { ...slideshow, ...patch };
		save('/api/settings/slideshow', patch);
	}

	const overlayFields: { key: OverlayField; label: string }[] = [
		{ key: 'clock', label: 'Clock' },
		{ key: 'date', label: 'Date' },
		{ key: 'weather', label: 'Weather' },
		{ key: 'nextEvent', label: 'Next event' }
	];

	function toggleOverlay(key: OverlayField) {
		overlayEdits++;
		overlay = { ...overlay, [key]: !overlay[key] };
		save('/api/settings/frame-overlay', { [key]: overlay[key] });
	}

	const transitions: { value: Transition; label: string }[] = [
		{ value: 'fade', label: 'Fade' },
		{ value: 'kenburns', label: 'Slow zoom' }
	];

	const onThisDayModes: { value: OnThisDayMode; label: string }[] = [
		{ value: 'off', label: 'Off' },
		{ value: 'favor', label: 'Favor' },
		{ value: 'only', label: 'Only' }
	];
	const onThisDayLines: Record<OnThisDayMode, string> = {
		off: 'Photos play in a random order.',
		favor: 'About one photo in three is from this time of year in earlier years.',
		only: 'Only photos from this time of year in earlier years, once there are enough of them.'
	};

	const livePhotoModes: { value: LivePhotoMode; label: string }[] = [
		{ value: 'off', label: 'Off' },
		{ value: 'on', label: 'On' }
	];

	const rows = [
		{
			key: 'homeMinutes',
			title: 'Back to home',
			line: 'Return to the home screen after this long without a touch.'
		},
		{
			key: 'frameMinutes',
			title: 'Photo frame',
			line: 'Start the photo frame after this long without a touch.'
		}
	] as const;

	function change(key: keyof IdleSettings, delta: number) {
		const next = Math.min(MAX_IDLE_MINUTES, Math.max(0, settings[key] + delta));
		if (next === settings[key]) return;
		// Optimistic: the screen and the running timers update before the save lands.
		settings = { ...settings, [key]: next };
		window.dispatchEvent(new CustomEvent(IDLE_SETTINGS_EVENT, { detail: settings }));
		save('/api/settings/idle', { [key]: next });
	}

	const label = (m: number) => (m === 0 ? 'Off' : m === 1 ? '1 minute' : `${m} minutes`);
</script>

<svelte:head>
	<title>Screen · Settings · Home Hub</title>
</svelte:head>

<section class="mx-auto flex w-full max-w-4xl flex-col gap-8 p-8 max-sm:p-3 short:gap-4 short:p-3">
	<h1 class="text-headline font-extrabold">Screen</h1>
	<Card>
		<div class="flex flex-col gap-6">
			<div class="flex flex-col gap-1">
				<h2 class="text-title font-bold">This device</h2>
				<p class="text-body text-ink-muted">
					Only this browser changes. The timers below apply to wall displays.
				</p>
			</div>
			<div class="flex flex-wrap gap-4" role="group" aria-label="This device">
				{#each roles as r (r.value)}
					<Button
						variant={role === r.value ? 'primary' : 'secondary'}
						aria-pressed={role === r.value}
						onclick={() => changeRole(r.value)}>{r.label}</Button
					>
				{/each}
			</div>
			<p class="text-body text-ink-muted">{roles.find((r) => r.value === role)?.line}</p>
		</div>
	</Card>
	<Card>
		<div class="flex flex-wrap items-center justify-between gap-6">
			<div class="flex flex-col gap-1">
				<h2 class="text-title font-bold">Wall screen</h2>
				<p class="text-body text-ink-muted" role="status" data-testid="wall-power">{wallText}</p>
			</div>
			<div class="flex flex-wrap gap-4">
				<Button disabled={wallBusy !== null} onclick={() => wallAction('wake')}
					>Wake the wall</Button
				>
				<Button variant="secondary" disabled={wallBusy !== null} onclick={() => wallAction('sleep')}
					>Sleep now</Button
				>
			</div>
		</div>
		{#if wallError}<p role="alert" class="mt-4 text-body text-danger">{wallError}</p>{/if}
	</Card>
	{#each rows as row (row.key)}
		<Card>
			<div class="flex flex-wrap items-center justify-between gap-6">
				<div class="flex flex-col gap-1">
					<h2 class="text-title font-bold">{row.title}</h2>
					<p class="text-body text-ink-muted">{row.line}</p>
				</div>
				<div class="flex items-center gap-4 max-sm:gap-2">
					<Button
						variant="secondary"
						aria-label="{row.title}: less"
						disabled={settings[row.key] === 0}
						onclick={() => change(row.key, -1)}>−</Button
					>
					<output class="min-w-tap-kid text-center text-title font-bold" data-testid={row.key}>
						{label(settings[row.key])}
					</output>
					<Button
						variant="secondary"
						aria-label="{row.title}: more"
						onclick={() => change(row.key, 1)}>+</Button
					>
				</div>
			</div>
		</Card>
	{/each}
	<Card>
		<div class="flex flex-col gap-6">
			<div class="flex flex-wrap items-center justify-between gap-6">
				<div class="flex flex-col gap-1">
					<h2 class="text-title font-bold">Next photo</h2>
					<p class="text-body text-ink-muted">How long each photo stays on the frame.</p>
				</div>
				<div class="flex items-center gap-4 max-sm:gap-2">
					<Button
						variant="secondary"
						aria-label="Next photo: less"
						disabled={slideshow.intervalSeconds === INTERVAL_STEPS[0]}
						onclick={() =>
							changeSlideshow({ intervalSeconds: stepInterval(slideshow.intervalSeconds, -1) })}
						>−</Button
					>
					<output class="min-w-tap-kid text-center text-title font-bold" data-testid="interval">
						{intervalLabel(slideshow.intervalSeconds)}
					</output>
					<Button
						variant="secondary"
						aria-label="Next photo: more"
						disabled={slideshow.intervalSeconds === INTERVAL_STEPS[INTERVAL_STEPS.length - 1]}
						onclick={() =>
							changeSlideshow({ intervalSeconds: stepInterval(slideshow.intervalSeconds, 1) })}
						>+</Button
					>
				</div>
			</div>
			<div class="flex flex-wrap items-center justify-between gap-6">
				<h2 class="text-title font-bold">Transition</h2>
				<div class="flex flex-wrap gap-4" role="group" aria-label="Transition">
					{#each transitions as t (t.value)}
						<Button
							variant={slideshow.transition === t.value ? 'primary' : 'secondary'}
							aria-pressed={slideshow.transition === t.value}
							onclick={() => changeSlideshow({ transition: t.value })}>{t.label}</Button
						>
					{/each}
				</div>
			</div>
			<div class="flex flex-col gap-4">
				<div class="flex flex-wrap items-center justify-between gap-6">
					<h2 class="text-title font-bold">On this day</h2>
					<div class="flex flex-wrap gap-4" role="group" aria-label="On this day">
						{#each onThisDayModes as m (m.value)}
							<Button
								variant={slideshow.onThisDay === m.value ? 'primary' : 'secondary'}
								aria-pressed={slideshow.onThisDay === m.value}
								onclick={() => changeSlideshow({ onThisDay: m.value })}>{m.label}</Button
							>
						{/each}
					</div>
				</div>
				<p class="text-body text-ink-muted">
					{onThisDayLines[slideshow.onThisDay]} Within three days of today.
				</p>
			</div>
			<div class="flex flex-col gap-4">
				<div class="flex flex-wrap items-center justify-between gap-6">
					<h2 class="text-title font-bold">Play Live Photos</h2>
					<div class="flex flex-wrap gap-4" role="group" aria-label="Play Live Photos">
						{#each livePhotoModes as m (m.value)}
							<Button
								variant={slideshow.livePhotos === m.value ? 'primary' : 'secondary'}
								aria-pressed={slideshow.livePhotos === m.value}
								onclick={() => changeSlideshow({ livePhotos: m.value })}>{m.label}</Button
							>
						{/each}
					</div>
				</div>
				<p class="text-body text-ink-muted">
					Photos with a short clip play it once, without sound, then stay on the still.
				</p>
			</div>
		</div>
	</Card>
	<Card>
		<div class="flex flex-col gap-6">
			<div class="flex flex-col gap-1">
				<h2 class="text-title font-bold">Show on the photo frame</h2>
				<p class="text-body text-ink-muted">
					Weather appears once a location is set in Settings, Weather.
				</p>
			</div>
			<div class="flex flex-wrap gap-4" role="group" aria-label="Show on the photo frame">
				{#each overlayFields as f (f.key)}
					<Button
						variant={overlay[f.key] ? 'primary' : 'secondary'}
						aria-pressed={overlay[f.key]}
						onclick={() => toggleOverlay(f.key)}>{f.label}</Button
					>
				{/each}
			</div>
		</div>
	</Card>
	<p class="text-body text-ink-muted">Any touch on the photo frame goes back to where you were.</p>
	{#if message}<p role="alert" class="text-body text-danger">{message}</p>{/if}
</section>
