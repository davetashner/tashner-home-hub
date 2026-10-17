<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import Button from '#lib/components/ui/Button.svelte';
	import { dayNumber, weekdayShort } from '#lib/domain/calendar-view/format.js';
	import { dateKeyOf, type DateKey } from '#lib/domain/calendar-view/zone.js';
	import {
		cleanMealText,
		currentWeek,
		MEAL_SLOTS,
		MEAL_TEXT_MAX,
		mealKey,
		mealMap,
		shiftWeek,
		weekDays,
		type MealEntry,
		type MealSlot
	} from '#lib/domain/meals.js';
	import { resolveTimeZone, runtimeZone } from '#lib/domain/time-zone.js';

	const JSON_HEADERS = { 'content-type': 'application/json' };
	const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

	let tz = $state('UTC');
	let week = $state<DateKey>('1970-01-05');
	let today = $state<DateKey>('1970-01-01');
	let mounted = $state(false);
	let cache = $state<Record<string, Record<string, string>>>({});
	let editing = $state<{ date: DateKey; meal: MealSlot } | null>(null);
	let draft = $state('');
	let failed = $state(false);

	const days = $derived(weekDays(week));
	const plan = $derived(cache[week] ?? {});
	const rangeLabel = $derived(
		mounted
			? `${weekdayShort(days[0])} ${dayNumber(days[0])} – ${weekdayShort(days[6])} ${dayNumber(days[6])}`
			: ''
	);

	async function load(monday: DateKey) {
		try {
			const res = await fetch(`/api/meals?week=${monday}`);
			if (res.ok) cache[monday] = Object.fromEntries(mealMap((await res.json()) as MealEntry[]));
		} catch {
			// Offline: keep whatever is cached.
		}
	}

	$effect(() => {
		if (mounted) void load(week);
	});

	onMount(() => {
		tz = resolveTimeZone(page.data.timeZone, runtimeZone());
		today = dateKeyOf(Date.now(), tz);
		week = currentWeek(Date.now(), tz);
		mounted = true;
	});

	function open(date: DateKey, meal: MealSlot) {
		editing = { date, meal };
		draft = plan[mealKey(date, meal)] ?? '';
	}

	/** Optimistic write: the grid changes first, then the server; a refusal puts it back. */
	async function save() {
		if (!editing) return;
		const { date, meal } = editing;
		const monday = week;
		const key = mealKey(date, meal);
		const text = cleanMealText(draft);
		const before = cache[monday]?.[key];
		editing = null;
		if (text === null && before === undefined) return;
		const next = { ...cache[monday] };
		if (text === null) delete next[key];
		else next[key] = text;
		cache[monday] = next;
		failed = false;
		let ok: boolean;
		try {
			const res =
				text === null
					? await fetch('/api/meals', {
							method: 'DELETE',
							headers: JSON_HEADERS,
							body: JSON.stringify({ date, meal })
						})
					: await fetch('/api/meals', {
							method: 'PUT',
							headers: JSON_HEADERS,
							body: JSON.stringify({ date, meal, title: text })
						});
			ok = res.ok;
		} catch {
			ok = false;
		}
		if (!ok) {
			failed = true;
			const back = { ...cache[monday] };
			if (before === undefined) delete back[key];
			else back[key] = before;
			cache[monday] = back;
		}
	}

	function remove() {
		draft = '';
		void save();
	}
</script>

<svelte:head>
	<title>Meals · Home Hub</title>
</svelte:head>

<section class="flex h-full min-h-0 flex-col gap-4 p-4 sm:p-6" data-testid="meals-page">
	<header class="flex flex-wrap items-center gap-3">
		<h1 class="mr-auto text-title font-extrabold">Meals</h1>
		<Button
			variant="secondary"
			aria-label="Previous week"
			data-testid="meals-prev"
			onclick={() => (week = shiftWeek(week, -1))}>‹</Button
		>
		<span class="text-lead font-extrabold" data-testid="meals-range">{rangeLabel}</span>
		<Button
			variant="secondary"
			aria-label="Next week"
			data-testid="meals-next"
			onclick={() => (week = shiftWeek(week, 1))}>›</Button
		>
		<Button variant="secondary" onclick={() => (week = currentWeek(Date.now(), tz))}
			>This week</Button
		>
	</header>

	{#if failed}
		<p class="rounded-control bg-danger-soft p-3 text-body font-bold" role="alert">
			Could not save that change. It was put back.
		</p>
	{/if}

	<div class="week min-h-0 flex-1 overflow-y-auto" data-testid="meals-grid">
		{#each days as date (date)}
			<div class="day" class:today={date === today} data-testid="meals-day" data-date={date}>
				<h2 class="px-1 text-lead font-extrabold">
					{weekdayShort(date)} <span class="tabular-nums">{dayNumber(date)}</span>
				</h2>
				{#each MEAL_SLOTS as slot (slot)}
					{@const text = plan[mealKey(date, slot)]}
					<button
						type="button"
						class="cell press"
						data-testid="meal-cell"
						data-slot={slot}
						aria-label="{cap(slot)} {weekdayShort(date)} {dayNumber(date)}"
						onclick={() => open(date, slot)}
					>
						<span class="text-caption font-extrabold text-ink-muted uppercase">{slot}</span>
						{#if text}
							<span class="text-body leading-tight font-bold">{text}</span>
						{/if}
					</button>
				{/each}
			</div>
		{/each}
	</div>
</section>

{#if editing}
	<div class="scrim" role="presentation">
		<form
			class="sheet"
			data-testid="meal-editor"
			onsubmit={(e) => {
				e.preventDefault();
				void save();
			}}
		>
			<h2 class="text-lead font-extrabold">
				{cap(editing.meal)} · {weekdayShort(editing.date)}
				{dayNumber(editing.date)}
			</h2>
			<!-- svelte-ignore a11y_autofocus -->
			<input
				class="field"
				type="text"
				maxlength={MEAL_TEXT_MAX}
				placeholder="What's for {editing.meal}?"
				aria-label="Meal"
				data-testid="meal-input"
				autofocus
				bind:value={draft}
			/>
			<div class="flex flex-wrap gap-3">
				<Button type="submit" data-testid="meal-save">Save</Button>
				<Button variant="secondary" onclick={() => (editing = null)}>Cancel</Button>
				<Button variant="danger" data-testid="meal-delete" onclick={remove}>Clear</Button>
			</div>
		</form>
	</div>
{/if}

<style>
	/* Phones and portrait: one column of days, each with its four slots. */
	.week {
		display: grid;
		gap: 0.75rem;
		grid-template-columns: minmax(0, 1fr);
		align-content: start;
	}
	/* Wall landscape: seven days across, slots stacked under each. */
	@media (orientation: landscape) and (min-width: 1100px) {
		.week {
			grid-template-columns: repeat(7, minmax(0, 1fr));
		}
	}
	.day {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.5rem;
		border: 2px solid var(--color-line);
		border-radius: var(--radius-card);
		background: var(--color-surface-raised);
	}
	.day.today {
		border-color: var(--color-accent);
		background: var(--color-accent-soft);
	}
	.cell {
		display: flex;
		min-height: calc(var(--spacing-tap) * 1.5);
		flex-direction: column;
		gap: 0.25rem;
		padding: 0.5rem 0.75rem;
		border: 0;
		border-radius: var(--radius-control);
		background: var(--color-surface-sunken);
		color: var(--color-ink);
		overflow-wrap: anywhere;
		text-align: left;
	}
	.press {
		cursor: pointer;
		transition: transform var(--duration-quick) var(--ease-out-soft);
	}
	.press:active {
		transform: scale(0.97);
		transition-duration: var(--duration-instant);
	}
	.press:focus-visible {
		outline: 4px solid var(--color-accent);
		outline-offset: 2px;
	}
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 50;
		display: grid;
		place-items: center;
		padding: 1rem;
		background: var(--color-scrim);
	}
	.sheet {
		display: flex;
		width: min(100%, 44rem);
		flex-direction: column;
		gap: 1rem;
		padding: 1.5rem;
		border-radius: var(--radius-sheet);
		background: var(--color-surface-raised);
	}
	.field {
		min-height: var(--spacing-tap);
		padding: 0 1rem;
		border: 2px solid var(--color-line);
		border-radius: var(--radius-control);
		background: var(--color-surface);
		color: var(--color-ink);
		font-size: var(--text-body);
	}
</style>
