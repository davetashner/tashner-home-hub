<script lang="ts">
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import { appearanceState } from '#lib/components/shell/appearance-state.svelte.js';
	import {
		THEME_CHOICES,
		THEME_LABELS,
		type Appearance,
		type AppearancePatch
	} from '#lib/domain/appearance.js';
	import { stepTime, timeLabel } from '#lib/domain/sound-settings.js';

	let message = $state('');
	const a = $derived(appearanceState.value);
	const dimChoices: (number | null)[] = [null, 0.9, 0.8, 0.7, 0.6, 0.5];
	const dimLabel = (d: number | null) => (d === null ? 'Off' : `${Math.round(d * 100)}%`);

	// Stepping stays inside the 12:00 to 23:59 range the server accepts.
	const stepEvening = (hhmm: string, direction: 1 | -1) => {
		const next = stepTime(hhmm, direction);
		return next < '12:00' || next > '23:45' ? hhmm : next;
	};

	function change(patch: AppearancePatch) {
		// Optimistic: the theme changes on the tap, the save follows; a failed save puts it back.
		const before: Appearance = a;
		appearanceState.value = { ...a, ...patch };
		message = '';
		const fail = () => {
			message = 'Could not save. Try again.';
			appearanceState.value = before;
		};
		void fetch('/api/settings/appearance', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(patch)
		})
			.then((res) => {
				if (!res.ok) fail();
			})
			.catch(fail);
	}
</script>

<svelte:head>
	<title>Theme and brightness · Settings · Home Hub</title>
</svelte:head>

<section class="mx-auto flex w-full max-w-4xl flex-col gap-8 p-8 max-sm:p-3 short:gap-4 short:p-3">
	<h1 class="text-headline font-extrabold">Theme and brightness</h1>
	<Card>
		<div class="flex flex-col gap-6">
			<div class="flex flex-col gap-1">
				<h2 class="text-title font-bold">Theme</h2>
				<p class="text-body text-ink-muted">
					Auto switches every screen to the dark theme in the evening: from 45 minutes after sunset
					until sunrise when the weather location is set, otherwise from the time below until the
					wake-up time in the sleep schedule.
				</p>
			</div>
			<div class="flex flex-wrap gap-4" role="group" aria-label="Theme">
				{#each THEME_CHOICES as c (c)}
					<Button
						variant={a.theme === c ? 'primary' : 'secondary'}
						aria-pressed={a.theme === c}
						onclick={() => a.theme !== c && change({ theme: c })}>{THEME_LABELS[c]}</Button
					>
				{/each}
			</div>
			<div class="flex flex-wrap items-center justify-between gap-6">
				<h3 class="text-title font-bold">Evening starts (no location)</h3>
				<div class="flex items-center gap-4 max-sm:gap-2">
					<Button
						variant="secondary"
						aria-label="Evening starts: earlier"
						onclick={() => change({ eveningStart: stepEvening(a.eveningStart, -1) })}>−</Button
					>
					<output
						class="min-w-tap-kid text-center text-title font-bold"
						data-testid="evening-start"
					>
						{timeLabel(a.eveningStart)}
					</output>
					<Button
						variant="secondary"
						aria-label="Evening starts: later"
						onclick={() => change({ eveningStart: stepEvening(a.eveningStart, 1) })}>+</Button
					>
				</div>
			</div>
		</div>
	</Card>
	<Card>
		<div class="flex flex-col gap-6">
			<div class="flex flex-col gap-1">
				<h2 class="text-title font-bold">Evening brightness</h2>
				<p class="text-body text-ink-muted">
					The wall display gets dimmer in the evening. This dims the picture on screen; it does not
					change the monitor's backlight. Photos in the photo frame never go below 85%.
				</p>
			</div>
			<div class="flex flex-wrap gap-4" role="group" aria-label="Evening brightness">
				{#each dimChoices as d (d)}
					<Button
						variant={a.dim === d ? 'primary' : 'secondary'}
						aria-pressed={a.dim === d}
						onclick={() => a.dim !== d && change({ dim: d })}>{dimLabel(d)}</Button
					>
				{/each}
			</div>
		</div>
	</Card>
	{#if message}<p role="alert" class="text-body text-danger">{message}</p>{/if}
</section>
