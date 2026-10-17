<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import { applySoundSettings, previewSound } from '#lib/components/kid/sound.js';
	import {
		DEFAULT_SOUND,
		parseSoundSettings,
		type SoundSettings
	} from '#lib/domain/celebrate-logic.js';
	import { SOUND_THEMES, THEME_LABELS } from '#lib/domain/sound-themes.js';
	import { quietSummary, stepTime, timeLabel } from '#lib/domain/sound-settings.js';

	let sound = $state<SoundSettings>({ ...DEFAULT_SOUND });
	let message = $state('');
	// Each change stamps a number, so a stale load or a late failure can't undo a newer change.
	let edits = 0;

	onMount(() => {
		const at = edits;
		void fetch('/api/settings/sound')
			.then(async (res) => {
				const loaded = res.ok ? parseSoundSettings(await res.json()) : null;
				if (loaded && at === edits) sound = loaded;
			})
			.catch(() => {});
	});

	function change(patch: Partial<SoundSettings>) {
		// Optimistic: the screen and the celebration sounds update before the save lands.
		const before = sound;
		const at = ++edits;
		sound = { ...sound, ...patch };
		applySoundSettings(sound);
		message = '';
		const fail = () => {
			message = 'Could not save. Try again.';
			if (at !== edits) return;
			sound = before;
			applySoundSettings(before);
		};
		void fetch('/api/settings/sound', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(patch)
		})
			.then((res) => {
				if (!res.ok) fail();
			})
			.catch(fail);
	}

	// The slider shows every drag step at once; the save waits for the finger to lift.
	function dragVolume(v: number) {
		sound = { ...sound, volume: v };
		applySoundSettings(sound);
	}

	const choices = [
		{ muted: false, label: 'On' },
		{ muted: true, label: 'Muted' }
	];

	const times = [
		{ key: 'quietStart', title: 'Quiet from' },
		{ key: 'quietEnd', title: 'Until' }
	] as const;
</script>

<svelte:head>
	<title>Sound · Settings · Home Hub</title>
</svelte:head>

<section class="mx-auto flex w-full max-w-4xl flex-col gap-8 p-8 max-sm:p-3 short:gap-4 short:p-3">
	<h1 class="text-headline font-extrabold">Sound</h1>
	<Card>
		<div class="flex flex-wrap items-center justify-between gap-6">
			<div class="flex flex-col gap-1">
				<h2 class="text-title font-bold">Celebration sounds</h2>
				<p class="text-body text-ink-muted">
					The chimes when a chore is done or a goal is reached.
				</p>
			</div>
			<div class="flex flex-wrap gap-4" role="group" aria-label="Celebration sounds">
				{#each choices as c (c.label)}
					<Button
						variant={sound.muted === c.muted ? 'primary' : 'secondary'}
						aria-pressed={sound.muted === c.muted}
						onclick={() => sound.muted !== c.muted && change({ muted: c.muted })}>{c.label}</Button
					>
				{/each}
			</div>
		</div>
	</Card>
	<Card>
		<div class="flex flex-col gap-6">
			<div class="flex flex-col gap-1">
				<h2 class="text-title font-bold">Quiet hours</h2>
				<p class="text-body text-ink-muted" data-testid="quiet-summary">
					{quietSummary(sound.quietStart, sound.quietEnd)}
				</p>
			</div>
			{#each times as t (t.key)}
				<div class="flex flex-wrap items-center justify-between gap-6">
					<h3 class="text-title font-bold">{t.title}</h3>
					<div class="flex items-center gap-4 max-sm:gap-2">
						<Button
							variant="secondary"
							aria-label="{t.title}: earlier"
							onclick={() => change({ [t.key]: stepTime(sound[t.key], -1) })}>−</Button
						>
						<output class="min-w-tap-kid text-center text-title font-bold" data-testid={t.key}>
							{timeLabel(sound[t.key])}
						</output>
						<Button
							variant="secondary"
							aria-label="{t.title}: later"
							onclick={() => change({ [t.key]: stepTime(sound[t.key], 1) })}>+</Button
						>
					</div>
				</div>
			{/each}
			<p class="text-body text-ink-muted">Set both to the same time to turn quiet hours off.</p>
		</div>
	</Card>
	<Card>
		<div class="flex flex-col gap-6">
			<h2 class="text-title font-bold">Sound theme</h2>
			<div class="flex flex-wrap gap-4" role="group" aria-label="Sound theme">
				{#each SOUND_THEMES as t (t)}
					<Button
						variant={sound.theme === t ? 'primary' : 'secondary'}
						aria-pressed={sound.theme === t}
						onclick={() => sound.theme !== t && change({ theme: t })}>{THEME_LABELS[t]}</Button
					>
				{/each}
			</div>
			<div class="flex flex-wrap items-center gap-6">
				<label class="text-title font-bold" for="sound-volume">Volume</label>
				<input
					id="sound-volume"
					type="range"
					min="0"
					max="100"
					step="5"
					value={sound.volume}
					class="h-tap min-w-tap-kid flex-1 accent-accent"
					oninput={(e) => dragVolume(e.currentTarget.valueAsNumber)}
					onchange={(e) => change({ volume: e.currentTarget.valueAsNumber })}
				/>
				<output class="min-w-tap text-center text-title font-bold" data-testid="volume"
					>{sound.volume}%</output
				>
				<Button variant="secondary" onclick={() => previewSound(sound)}>Preview</Button>
			</div>
		</div>
	</Card>
	{#if message}<p role="alert" class="text-body text-danger">{message}</p>{/if}
</section>
