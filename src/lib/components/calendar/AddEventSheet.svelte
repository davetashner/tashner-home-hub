<script lang="ts">
	import OnScreenKeyboard from '#lib/components/lists/OnScreenKeyboard.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Stepper from '#lib/components/calendar/Stepper.svelte';
	import { dayHeading } from '#lib/domain/calendar-view/format.js';
	import {
		clockLabel,
		draftError,
		LOCATION_MAX,
		NOTES_MAX,
		setDate,
		setEnd,
		setEndDate,
		setStart,
		TITLE_MAX,
		type EventDraft
	} from '#lib/domain/calendar-view/new-event.js';
	import { addDays, type DateKey } from '#lib/domain/calendar-view/zone.js';

	export interface WritableCalendar {
		id: string;
		name: string;
		/** Account label, shown when more than one account is connected. */
		account: string;
	}
	interface Props {
		draft: EventDraft;
		calendars: WritableCalendar[];
		today: DateKey;
		/** The wall has no OS keyboard: text goes in through the on-screen one. */
		wall: boolean;
		/** `edit` changes an existing event: no calendar choice, different wording. */
		mode?: 'add' | 'edit';
		onsubmit: (draft: EventDraft) => void;
		onclose: () => void;
	}
	let {
		draft = $bindable(),
		calendars,
		today,
		wall,
		mode = 'add',
		onsubmit,
		onclose
	}: Props = $props();

	type TextField = 'title' | 'location' | 'notes';
	const FIELDS: Record<TextField, { label: string; max: number }> = {
		title: { label: 'Title', max: TITLE_MAX },
		location: { label: 'Where (optional)', max: LOCATION_MAX },
		notes: { label: 'Notes (optional)', max: NOTES_MAX }
	};
	let typing = $state<TextField | null>(null);
	let problem = $state('');

	const dayLabel = (k: DateKey) => {
		const h = dayHeading(k, today);
		return `${h.lead}, ${h.rest}`;
	};
	const showAccount = $derived(new Set(calendars.map((c) => c.account)).size > 1);

	function type(text: string) {
		if (typing) draft = { ...draft, [typing]: text };
		typing = null;
	}

	function save() {
		const err = draftError(draft);
		if (err) {
			problem = err;
			return;
		}
		onsubmit(draft);
	}

	const dayStep = (k: DateKey, n: number) => addDays(k, n);
	const input =
		'min-h-tap w-full min-w-0 rounded-control border-2 border-line bg-surface px-4 text-body text-ink';
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="fixed inset-0 z-50 flex items-end justify-center p-safe-8 landscape:items-center">
	<button type="button" aria-label="Close" class="scrim absolute inset-0" onclick={onclose}
	></button>
	<div
		role="dialog"
		aria-modal="true"
		aria-labelledby="add-event-title"
		data-testid="add-event-sheet"
		class="sheet relative flex max-h-full w-full max-w-4xl flex-col gap-5 overflow-y-auto overscroll-contain rounded-sheet bg-surface-raised p-8 shadow-float short:gap-3 short:p-4"
	>
		<h2 id="add-event-title" class="text-title leading-tight font-extrabold">
			{mode === 'edit' ? 'Edit event' : 'Add event'}
		</h2>

		{#if typing}
			<p class="text-lead font-extrabold">{FIELDS[typing].label}</p>
			{#key typing}
				<OnScreenKeyboard
					onsubmit={type}
					placeholder="Type here…"
					submitLabel="Done"
					max={FIELDS[typing].max}
				/>
			{/key}
			<Button variant="secondary" class="self-end" onclick={() => (typing = null)}>Cancel</Button>
		{:else}
			{#each Object.keys(FIELDS) as f (f)}
				{@const field = f as TextField}
				<div class="flex flex-col gap-1">
					<label for="ev-{field}" class="text-caption font-extrabold text-ink-muted"
						>{FIELDS[field].label}</label
					>
					{#if wall}
						<div class="flex gap-2">
							<button
								type="button"
								id="ev-{field}"
								class="{input} text-left"
								data-testid="ev-{field}"
								onclick={() => (typing = field)}
							>
								{#if draft[field]}<span class="line-clamp-1">{draft[field]}</span>{:else}<span
										class="text-ink-muted">Tap to type</span
									>{/if}
							</button>
							{#if draft[field]}
								<Button
									variant="secondary"
									aria-label="Clear {FIELDS[field].label}"
									onclick={() => (draft = { ...draft, [field]: '' })}>Clear</Button
								>
							{/if}
						</div>
					{:else if field === 'notes'}
						<textarea
							id="ev-{field}"
							bind:value={draft.notes}
							maxlength={NOTES_MAX}
							rows="3"
							data-testid="ev-{field}"
							class="{input} py-3"></textarea>
					{:else}
						<input
							id="ev-{field}"
							bind:value={draft[field]}
							maxlength={FIELDS[field].max}
							autocomplete="off"
							data-testid="ev-{field}"
							class={input}
						/>
					{/if}
				</div>
			{/each}

			{#if mode === 'edit'}
				<!-- The calendar is fixed once the event exists. -->
			{:else if calendars.length > 1}
				<div role="group" aria-label="Calendar" class="flex flex-wrap gap-2">
					{#each calendars as c (c.id)}
						<button
							type="button"
							class="cal-chip"
							aria-pressed={draft.calendarId === c.id}
							onclick={() => (draft = { ...draft, calendarId: c.id })}
						>
							{c.name}{showAccount ? ` · ${c.account}` : ''}
						</button>
					{/each}
				</div>
			{:else if calendars[0]}
				<p class="text-body text-ink-muted">Saves to {calendars[0].name}</p>
			{/if}

			<label class="flex min-h-tap items-center gap-4 text-body font-extrabold">
				<input
					type="checkbox"
					class="size-8"
					checked={draft.allDay}
					onchange={(e) => (draft = { ...draft, allDay: e.currentTarget.checked })}
				/>
				All day
			</label>

			<Stepper
				label={draft.allDay ? 'First day' : 'Day'}
				value={dayLabel(draft.date)}
				testid="ev-date"
				steps={[
					{ text: '-1 wk', delta: -7 },
					{ text: '-1 d', delta: -1 },
					{ text: '+1 d', delta: 1 },
					{ text: '+1 wk', delta: 7 }
				]}
				onstep={(n) => (draft = setDate(draft, dayStep(draft.date, n)))}
			/>
			{#if draft.allDay}
				<Stepper
					label="Last day"
					value={dayLabel(draft.endDate)}
					testid="ev-end-date"
					steps={[
						{ text: '-1 d', delta: -1 },
						{ text: '+1 d', delta: 1 }
					]}
					onstep={(n) => (draft = setEndDate(draft, dayStep(draft.endDate, n)))}
				/>
			{:else}
				<Stepper
					label="Starts"
					value={clockLabel(draft.startMin)}
					testid="ev-start"
					steps={[
						{ text: '-1 hr', delta: -60 },
						{ text: '-15', delta: -15 },
						{ text: '+15', delta: 15 },
						{ text: '+1 hr', delta: 60 }
					]}
					onstep={(n) => (draft = setStart(draft, draft.startMin + n))}
				/>
				<Stepper
					label="Ends"
					value={clockLabel(draft.endMin)}
					testid="ev-end"
					steps={[
						{ text: '-1 hr', delta: -60 },
						{ text: '-15', delta: -15 },
						{ text: '+15', delta: 15 },
						{ text: '+1 hr', delta: 60 }
					]}
					onstep={(n) => (draft = setEnd(draft, draft.endMin + n))}
				/>
			{/if}

			{#if problem}<p class="text-body font-extrabold text-danger" role="alert">{problem}</p>{/if}
			<div class="flex justify-end gap-4">
				<Button variant="secondary" onclick={onclose}>Cancel</Button>
				<Button onclick={save} data-testid="ev-save"
					>{mode === 'edit' ? 'Save changes' : 'Save'}</Button
				>
			</div>
		{/if}
	</div>
</div>

<style>
	.scrim {
		background: color-mix(in oklch, var(--color-ink) 45%, transparent);
		animation: fade var(--duration-base) linear both;
	}
	.sheet {
		animation: rise var(--duration-base) var(--ease-out-soft) both;
	}
	.cal-chip {
		min-height: var(--spacing-tap);
		padding: 0 1.25rem;
		border: 2px solid var(--color-line);
		border-radius: var(--radius-chip);
		background: var(--color-surface-raised);
		font-weight: 800;
		cursor: pointer;
	}
	.cal-chip[aria-pressed='true'] {
		border-color: var(--color-accent);
		background: var(--color-accent);
		color: var(--color-on-accent);
	}
	@keyframes fade {
		from {
			opacity: 0;
		}
	}
	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(2rem);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.scrim,
		.sheet {
			animation: none;
		}
	}
</style>
