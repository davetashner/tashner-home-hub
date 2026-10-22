<script lang="ts">
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import { device, wave } from '#lib/components/shell/wave-state.svelte.js';
	import {
		writeDeviceWaveOff,
		WAVE_CHOICES,
		WAVE_LABELS,
		type WaveChoice
	} from '#lib/domain/wave-background.js';

	import { onMount } from 'svelte';
	import {
		daysInMonth,
		MAX_BIRTHDAYS,
		MAX_LABEL,
		monthName,
		sortBirthdays,
		type Birthday
	} from '#lib/domain/birthdays.js';

	let message = $state('');

	// Birthday dates (hub-6pv.6.10). The wall shows the birthday scene on these days when the
	// background is Auto. Labels stay on this page. Loaded with labels (adult-only GET).
	let birthdays = $state<Birthday[]>([]);
	let loaded = $state(false);
	/** Set by the first edit: a slower load must not overwrite a newer edit. */
	let touched = false;
	let newMonth = $state(1);
	let newDay = $state(1);
	let newLabel = $state('');
	let saveQueue: Promise<unknown> = Promise.resolve();

	onMount(() => {
		void fetch('/api/settings/birthdays')
			.then((res) => (res.ok ? res.json() : null))
			.then((body: { birthdays?: Birthday[] } | null) => {
				if (!touched && body?.birthdays) birthdays = body.birthdays;
			})
			.catch(() => {})
			.finally(() => (loaded = true));
	});

	function saveBirthdays(next: Birthday[], before: Birthday[]) {
		touched = true;
		birthdays = next;
		wave.birthdays = next.map(({ month, day }) => ({ month, day }));
		message = '';
		const fail = () => {
			message = 'Could not save. Try again.';
			birthdays = before;
			wave.birthdays = before.map(({ month, day }) => ({ month, day }));
		};
		// One write at a time, so two quick edits can't land out of order.
		saveQueue = saveQueue.then(() =>
			fetch('/api/settings/birthdays', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ birthdays: next })
			})
				.then((res) => {
					if (!res.ok) fail();
				})
				.catch(fail)
		);
	}

	const taken = $derived(birthdays.some((b) => b.month === newMonth && b.day === newDay));
	const full = $derived(birthdays.length >= MAX_BIRTHDAYS);

	function addBirthday() {
		if (taken || full) return;
		const label = newLabel.trim();
		const entry: Birthday = label
			? { month: newMonth, day: newDay, label }
			: { month: newMonth, day: newDay };
		saveBirthdays(sortBirthdays([...birthdays, entry]), birthdays);
		newLabel = '';
	}

	function removeBirthday(b: Birthday) {
		saveBirthdays(
			birthdays.filter((x) => !(x.month === b.month && x.day === b.day)),
			birthdays
		);
	}

	function setDevice(off: boolean) {
		device.off = off;
		try {
			writeDeviceWaveOff(localStorage, off);
		} catch {
			/* storage blocked */
		}
	}

	function choose(choice: WaveChoice) {
		if (wave.choice === choice) return;
		// Optimistic: the background changes on the tap, the save follows.
		const before = wave.choice;
		wave.choice = choice;
		message = '';
		const fail = () => {
			message = 'Could not save. Try again.';
			wave.choice = before;
		};
		void fetch('/api/settings/wave-background', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ choice })
		})
			.then((res) => {
				if (!res.ok) fail();
			})
			.catch(fail);
	}
</script>

<svelte:head>
	<title>Background · Settings · Home Hub</title>
</svelte:head>

<section class="mx-auto flex w-full max-w-4xl flex-col gap-8 p-8 max-sm:p-3">
	<h1 class="text-headline font-extrabold">Background</h1>
	<Card>
		<div class="flex flex-col gap-6">
			<p class="text-body text-ink-muted">
				Auto is Dusk by day, Sorbet from 45 minutes before sunset to 45 minutes after (once a
				weather location is set), and Night with the night theme. Night shows with the night theme.
			</p>
			<div class="flex flex-wrap gap-4" role="group" aria-label="Background">
				{#each WAVE_CHOICES as c (c)}
					<Button
						variant={wave.choice === c ? 'primary' : 'secondary'}
						aria-pressed={wave.choice === c}
						onclick={() => choose(c)}>{WAVE_LABELS[c]}</Button
					>
				{/each}
			</div>
		</div>
	</Card>
	<Card>
		<div class="flex flex-col gap-6">
			<p class="text-body text-ink-muted">
				Only for this phone, tablet or screen. Saved on the device, not for the household. When it
				is not shown, you see the still gradient.
			</p>
			<div class="flex flex-wrap gap-4" role="group" aria-label="On this device">
				<Button
					variant={device.off ? 'secondary' : 'primary'}
					aria-pressed={!device.off}
					onclick={() => setDevice(false)}>Show here</Button
				>
				<Button
					variant={device.off ? 'primary' : 'secondary'}
					aria-pressed={device.off}
					onclick={() => setDevice(true)}>Not on this device</Button
				>
			</div>
		</div>
	</Card>
	<Card>
		<div class="flex flex-col gap-6">
			<div class="flex flex-col gap-1">
				<h2 class="text-title font-bold">Birthdays</h2>
				<p class="text-body text-ink-muted">
					On these days, Auto shows a birthday scene (cake, unicorn and balloons) instead of the
					usual season. It repeats every year. A Feb 29 date shows on Feb 28 in other years. Names
					are only shown here, never on the wall.
				</p>
			</div>
			<ul class="flex flex-col gap-3" aria-label="Birthday dates" data-testid="birthday-list">
				{#each birthdays as b (`${b.month}-${b.day}`)}
					<li class="flex items-center justify-between gap-4">
						<span class="text-body font-bold" data-testid="birthday-item">
							{monthName(b.month)}
							{b.day}{b.label ? ` · ${b.label}` : ''}
						</span>
						<Button
							variant="secondary"
							aria-label="Remove {monthName(b.month)} {b.day}"
							onclick={() => removeBirthday(b)}>Remove</Button
						>
					</li>
				{:else}
					<li class="text-body text-ink-muted">{loaded ? 'No birthdays yet.' : 'Loading…'}</li>
				{/each}
			</ul>
			<div class="flex flex-wrap items-center gap-4" role="group" aria-label="Add a birthday">
				<select
					aria-label="Month"
					class="min-h-tap rounded-control border-2 border-line bg-surface px-6 text-body text-ink"
					bind:value={newMonth}
					onchange={() => (newDay = Math.min(newDay, daysInMonth(newMonth)))}
				>
					{#each Array.from({ length: 12 }, (_, i) => i + 1) as m (m)}
						<option value={m}>{monthName(m)}</option>
					{/each}
				</select>
				<select
					aria-label="Day"
					class="min-h-tap rounded-control border-2 border-line bg-surface px-6 text-body text-ink"
					bind:value={newDay}
				>
					{#each Array.from({ length: daysInMonth(newMonth) }, (_, i) => i + 1) as d (d)}
						<option value={d}>{d}</option>
					{/each}
				</select>
				<input
					aria-label="Name (optional, shown only here)"
					placeholder="Name (optional)"
					maxlength={MAX_LABEL}
					class="min-h-tap min-w-0 flex-1 rounded-control border-2 border-line bg-surface px-6 text-body text-ink"
					bind:value={newLabel}
				/>
				<Button disabled={taken || full} onclick={addBirthday}>Add</Button>
			</div>
			{#if taken}<p class="text-body text-ink-muted">That date is already in the list.</p>{/if}
		</div>
	</Card>
	{#if message}<p role="alert" class="text-body text-danger">{message}</p>{/if}
</section>
