<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import {
		DEFAULT_SLEEP_SCHEDULE,
		RESLEEP_MAX,
		RESLEEP_MIN,
		resolveSleepSchedule,
		type SleepSchedule
	} from '#lib/domain/display-power.js';
	import { stepTime, timeLabel } from '#lib/domain/sound-settings.js';

	type Patch = {
		enabled?: boolean;
		weekdaySleep?: string;
		weekdayWake?: string;
		weekendSleep?: string;
		weekendWake?: string;
		resleepMinutes?: number;
	};

	let schedule = $state<SleepSchedule>(structuredClone(DEFAULT_SLEEP_SCHEDULE));
	let message = $state('');
	// Each change stamps a number, so a stale load or a late failure can't undo a newer change.
	let edits = 0;

	onMount(() => {
		const at = edits;
		void fetch('/api/settings/sleep-schedule')
			.then(async (res) => {
				if (res.ok && at === edits) schedule = resolveSleepSchedule(await res.json());
			})
			.catch(() => {});
	});

	function apply(s: SleepSchedule, p: Patch): SleepSchedule {
		return {
			enabled: p.enabled ?? s.enabled,
			weekday: {
				sleep: p.weekdaySleep ?? s.weekday.sleep,
				wake: p.weekdayWake ?? s.weekday.wake
			},
			weekend: {
				sleep: p.weekendSleep ?? s.weekend.sleep,
				wake: p.weekendWake ?? s.weekend.wake
			},
			resleepMinutes: p.resleepMinutes ?? s.resleepMinutes
		};
	}

	function change(patch: Patch) {
		// Optimistic: the screen updates first; a failed save puts the old values back.
		const before = schedule;
		const at = ++edits;
		schedule = apply(schedule, patch);
		message = '';
		const fail = () => {
			message = 'Could not save. Try again.';
			if (at === edits) schedule = before;
		};
		void fetch('/api/settings/sleep-schedule', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(patch)
		})
			.then((res) => {
				if (!res.ok) fail();
			})
			.catch(fail);
	}

	const choices = [
		{ enabled: true, label: 'On' },
		{ enabled: false, label: 'Off' }
	];

	const nights = [
		{
			id: 'weekday',
			title: 'School nights (Sun–Thu)',
			line: 'Sunday to Thursday nights, so you wake up Monday to Friday.',
			sleep: 'weekdaySleep',
			wake: 'weekdayWake'
		},
		{
			id: 'weekend',
			title: 'Weekend nights (Fri–Sat)',
			line: 'Friday and Saturday nights, so you wake up Saturday and Sunday.',
			sleep: 'weekendSleep',
			wake: 'weekendWake'
		}
	] as const;

	const times = (n: 'weekday' | 'weekend') =>
		[
			{ key: n === 'weekday' ? 'weekdaySleep' : 'weekendSleep', title: 'Lights out', at: 'sleep' },
			{ key: n === 'weekday' ? 'weekdayWake' : 'weekendWake', title: 'Wake up', at: 'wake' }
		] as const;
</script>

<svelte:head>
	<title>Sleep schedule · Settings · Home Hub</title>
</svelte:head>

<section class="mx-auto flex w-full max-w-4xl flex-col gap-8 p-8 max-sm:p-3">
	<h1 class="text-headline font-extrabold">Sleep schedule</h1>
	<Card>
		<div class="flex flex-wrap items-center justify-between gap-6">
			<div class="flex flex-col gap-1">
				<h2 class="text-title font-bold">Turn the display off at night</h2>
				<p class="text-body text-ink-muted">
					{schedule.enabled
						? 'The wall display sleeps and wakes on the times below.'
						: 'The display stays on all night.'}
				</p>
			</div>
			<div class="flex flex-wrap gap-4" role="group" aria-label="Sleep schedule">
				{#each choices as c (c.label)}
					<Button
						variant={schedule.enabled === c.enabled ? 'primary' : 'secondary'}
						aria-pressed={schedule.enabled === c.enabled}
						onclick={() => schedule.enabled !== c.enabled && change({ enabled: c.enabled })}
						>{c.label}</Button
					>
				{/each}
			</div>
		</div>
	</Card>
	{#each nights as n (n.id)}
		<Card>
			<div class="flex flex-col gap-6">
				<div class="flex flex-col gap-1">
					<h2 class="text-title font-bold">{n.title}</h2>
					<p class="text-body text-ink-muted">{n.line}</p>
				</div>
				{#each times(n.id) as t (t.key)}
					{@const value = schedule[n.id][t.at]}
					<div class="flex flex-wrap items-center justify-between gap-6">
						<h3 class="text-title font-bold">{t.title}</h3>
						<div class="flex items-center gap-4 max-sm:gap-2">
							<Button
								variant="secondary"
								aria-label="{n.title} {t.title}: earlier"
								onclick={() => change({ [t.key]: stepTime(value, -1) })}>−</Button
							>
							<output class="min-w-tap-kid text-center text-title font-bold" data-testid={t.key}>
								{timeLabel(value)}
							</output>
							<Button
								variant="secondary"
								aria-label="{n.title} {t.title}: later"
								onclick={() => change({ [t.key]: stepTime(value, 1) })}>+</Button
							>
						</div>
					</div>
				{/each}
			</div>
		</Card>
	{/each}
	<Card>
		<div class="flex flex-wrap items-center justify-between gap-6">
			<div class="flex flex-col gap-1">
				<h2 class="text-title font-bold">Sleep again after a touch</h2>
				<p class="text-body text-ink-muted" data-testid="resleep-summary">
					After a touch at night, the display sleeps again after {schedule.resleepMinutes}
					{schedule.resleepMinutes === 1 ? 'minute' : 'minutes'}.
				</p>
			</div>
			<div class="flex items-center gap-4 max-sm:gap-2">
				<Button
					variant="secondary"
					aria-label="Minutes before sleeping again: fewer"
					onclick={() =>
						schedule.resleepMinutes > RESLEEP_MIN &&
						change({ resleepMinutes: schedule.resleepMinutes - 1 })}>−</Button
				>
				<output class="min-w-tap-kid text-center text-title font-bold" data-testid="resleepMinutes">
					{schedule.resleepMinutes} min
				</output>
				<Button
					variant="secondary"
					aria-label="Minutes before sleeping again: more"
					onclick={() =>
						schedule.resleepMinutes < RESLEEP_MAX &&
						change({ resleepMinutes: schedule.resleepMinutes + 1 })}>+</Button
				>
			</div>
		</div>
	</Card>
	{#if message}<p role="alert" class="text-body text-danger">{message}</p>{/if}
</section>
