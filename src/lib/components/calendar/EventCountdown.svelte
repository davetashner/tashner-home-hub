<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Icon from '#lib/components/shell/Icon.svelte';
	import type { CalEvent } from '#lib/domain/calendar-view/layout.js';
	import { dateKeyOf, utcDateKey } from '#lib/domain/calendar-view/zone.js';
	import {
		COUNTDOWN_WINDOW_DAYS,
		countdownDay,
		countdownLabel,
		daysUntil,
		showsFrom,
		type CountdownLike
	} from '#lib/domain/countdowns.js';

	// CD-4: count down to a calendar event from its sheet. Anyone can, kids included.
	let { event, tz }: { event: CalEvent; tz: string } = $props();

	let counting = $state(false);
	let loaded = $state(false);
	let message = $state('');

	const target = $derived(
		event.allDay ? utcDateKey(event.startsAt) : dateKeyOf(event.startsAt, tz)
	);
	const days = $derived(daysUntil(target, dateKeyOf(Date.now(), tz)) ?? -1);
	const when = $derived(
		days > COUNTDOWN_WINDOW_DAYS
			? `Shows on Home from ${countdownDay(showsFrom(target)!)}`
			: days === 0
				? 'It is today'
				: `${countdownLabel(days)} to go`
	);

	onMount(() => {
		fetch('/api/countdowns')
			.then((r) => (r.ok ? r.json() : []))
			.then((list: CountdownLike[]) => {
				counting = list.some((c) => c.eventId === event.id);
				loaded = true;
			})
			.catch(() => (loaded = true));
	});

	async function start() {
		// Optimistic: the sheet says so at once, then the server catches up.
		counting = true;
		message = '';
		try {
			const res = await fetch('/api/countdowns', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ eventId: event.id })
			});
			if (!res.ok) throw new Error();
		} catch {
			counting = false;
			message = 'Could not start the countdown. Try again.';
		}
	}
</script>

{#if loaded && days >= 0}
	<div
		class="flex flex-wrap items-center gap-6 rounded-card bg-accent-soft p-6 short:gap-3 short:p-3"
		data-testid="event-countdown"
	>
		<span class="text-headline text-accent-press" aria-hidden="true"><Icon name="timer" /></span>
		<div class="flex min-w-48 flex-1 flex-col">
			<span class="text-lead font-extrabold">
				{counting ? 'Counting down on Home' : 'Show a countdown on Home?'}
			</span>
			<span class="text-body text-ink-muted" data-testid="event-countdown-when">{when}</span>
			{#if message}<span class="text-body text-danger" role="alert">{message}</span>{/if}
		</div>
		{#if !counting}
			<Button data-testid="event-countdown-start" onclick={start}>Count down to this</Button>
		{/if}
	</div>
{/if}
