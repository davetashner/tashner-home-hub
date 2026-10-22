<script lang="ts">
	import type { ChoreInput, ChoreKind, ChoreView, Weekday } from '#lib/server/domain/chores.js';
	import type { Member } from '#lib/server/domain/members.js';
	import Button from './ui/Button.svelte';
	import MemberAvatar from './MemberAvatar.svelte';

	interface Props {
		chore?: ChoreView;
		/** What a new item is; an edited one keeps its own. Habits have no stars or approval. */
		choreKind?: ChoreKind;
		members: Member[];
		/** Whether a new item starts out needing a grown-up's OK (the household setting). */
		approvalDefault?: boolean;
		/** Saves the chore; resolves to an error message, or undefined on success. */
		onsave: (input: ChoreInput) => Promise<string | undefined>;
		oncancel: () => void;
	}

	let {
		chore,
		choreKind = 'star_job',
		members,
		approvalDefault = false,
		onsave,
		oncancel
	}: Props = $props();
	const habit = $derived((chore?.kind ?? choreKind) === 'habit');

	const ICONS = [
		'🍽️',
		'🧸',
		'🛏️',
		'🦷',
		'🧺',
		'🐶',
		'🐟',
		'🪴',
		'📚',
		'🧹',
		'🪟',
		'🎒',
		'🚿',
		'🗑️'
	];
	const TIMES = [
		['morning', 'Morning'],
		['afternoon', 'Afternoon'],
		['evening', 'Evening'],
		['anytime', 'Anytime']
	] as const;
	const KINDS = [
		['once', 'One time'],
		['daily', 'Every day'],
		['weekdays', 'Certain days'],
		['weekly', 'Weekly'],
		['monthly', 'Monthly'],
		['flex1', 'Once a week, any day'],
		['flex2', 'Every 2 weeks, any day']
	] as const;
	// Any-day jobs are Star Jobs only: a habit is an everyday check.
	const kinds = $derived(habit ? KINDS.filter(([v]) => !v.startsWith('flex')) : KINDS);
	const DAYS: [Weekday, string][] = [
		['SU', 'Sun'],
		['MO', 'Mon'],
		['TU', 'Tue'],
		['WE', 'Wed'],
		['TH', 'Thu'],
		['FR', 'Fri'],
		['SA', 'Sat']
	];

	// Form fields start from the chore being edited, then belong to the form.
	/* svelte-ignore state_referenced_locally */
	let title = $state(chore?.title ?? '');
	/* svelte-ignore state_referenced_locally */
	let icon = $state(chore?.icon ?? '');
	/* svelte-ignore state_referenced_locally */
	let stars = $state(chore?.stars ?? 1);
	/* svelte-ignore state_referenced_locally */
	let memberIds = $state<string[]>(chore?.memberIds ?? []);
	/* svelte-ignore state_referenced_locally */
	let timeOfDay = $state<string>(chore?.timeOfDay ?? 'anytime');
	/* svelte-ignore state_referenced_locally */
	let kind = $state<string>(
		chore?.schedule.type === 'flex'
			? `flex${chore.schedule.every}`
			: (chore?.schedule.type ?? 'daily')
	);
	/* svelte-ignore state_referenced_locally */
	let days = $state<Weekday[]>(chore?.schedule.type === 'weekdays' ? chore.schedule.days : []);
	/* svelte-ignore state_referenced_locally */
	let onceDate = $state(chore?.schedule.type === 'once' ? chore.schedule.start : '');
	/* svelte-ignore state_referenced_locally */
	let approval = $state(chore?.requiresApproval ?? approvalDefault);
	let message = $state<string>();

	const choice =
		'press flex items-center justify-center border-2 border-line text-body peer-checked:border-ink peer-checked:ring-4 peer-checked:ring-ink peer-focus-visible:outline-4 peer-focus-visible:outline-accent';

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		const schedule =
			kind === 'weekdays'
				? { type: 'weekdays', days }
				: kind === 'once'
					? { type: 'once', ...(onceDate ? { start: onceDate } : {}) }
					: kind.startsWith('flex')
						? { type: 'flex', every: kind === 'flex2' ? 2 : 1 }
						: { type: kind };
		const common = {
			title,
			icon: icon || null,
			memberIds,
			timeOfDay,
			schedule: schedule as ChoreInput['schedule']
		};
		message = await onsave(
			habit
				? { ...common, ...(chore ? {} : { kind: 'habit' as const }) }
				: { ...common, stars, requiresApproval: approval }
		);
	}
</script>

<form onsubmit={submit} class="flex flex-col gap-6" data-testid="chore-form">
	<label class="flex flex-col gap-2">
		<span class="text-caption text-ink-muted">{habit ? 'Habit' : 'Star Job'}</span>
		<input
			bind:value={title}
			maxlength="60"
			required
			class="min-h-tap rounded-control border-2 border-control-line bg-control px-4 text-body"
		/>
	</label>

	<fieldset class="flex min-w-0 flex-wrap gap-3">
		<legend class="mb-2 text-caption text-ink-muted">Picture</legend>
		<label class="relative">
			<input type="radio" name="icon" value="" bind:group={icon} class="peer sr-only" />
			<span class="{choice} min-h-tap min-w-tap rounded-chip bg-surface-raised px-4">None</span>
		</label>
		{#each ICONS as value (value)}
			<label class="relative">
				<input type="radio" name="icon" {value} bind:group={icon} class="peer sr-only" />
				<span class="{choice} size-tap rounded-chip bg-surface-raised">{value}</span>
			</label>
		{/each}
	</fieldset>

	{#if !habit}<div class="flex flex-wrap items-center gap-4">
			<span class="text-caption text-ink-muted">Stars</span>
			<Button
				variant="secondary"
				aria-label="Fewer stars"
				disabled={stars <= 1}
				onclick={() => (stars -= 1)}>-</Button
			>
			<output aria-label="Star count" class="min-w-tap text-center text-title font-extrabold"
				>{stars}</output
			>
			<Button
				variant="secondary"
				aria-label="More stars"
				disabled={stars >= 10}
				onclick={() => (stars += 1)}>+</Button
			>
		</div>{/if}

	<fieldset class="flex min-w-0 flex-wrap gap-3">
		<legend class="mb-2 text-caption text-ink-muted">Who</legend>
		{#each members as m (m.id)}
			<label class="relative flex max-w-full flex-col items-center gap-1">
				<input type="checkbox" value={m.id} bind:group={memberIds} class="peer sr-only" />
				<span
					class="press flex max-w-full items-center gap-3 rounded-chip border-2 border-control-line bg-control p-2 pr-4 peer-checked:border-ink peer-checked:ring-4 peer-checked:ring-ink peer-focus-visible:outline-4 peer-focus-visible:outline-accent"
				>
					<MemberAvatar name={m.name} color={m.color} avatar={m.avatar} size="sm" />
					<span class="min-w-0 text-body break-words">{m.name}</span>
				</span>
			</label>
		{/each}
	</fieldset>

	<fieldset class="flex min-w-0 flex-wrap gap-3">
		<legend class="mb-2 text-caption text-ink-muted">When in the day</legend>
		{#each TIMES as [value, label] (value)}
			<label class="relative">
				<input type="radio" name="timeOfDay" {value} bind:group={timeOfDay} class="peer sr-only" />
				<span class="{choice} min-h-tap rounded-chip bg-surface-raised px-6">{label}</span>
			</label>
		{/each}
	</fieldset>

	<fieldset class="flex min-w-0 flex-wrap gap-3">
		<legend class="mb-2 text-caption text-ink-muted">How often</legend>
		{#each kinds as [value, label] (value)}
			<label class="relative">
				<input type="radio" name="kind" {value} bind:group={kind} class="peer sr-only" />
				<span class="{choice} min-h-tap rounded-chip bg-surface-raised px-6">{label}</span>
			</label>
		{/each}
	</fieldset>

	{#if kind === 'weekdays'}
		<fieldset class="flex min-w-0 flex-wrap gap-3" aria-label="Days of the week">
			{#each DAYS as [value, label] (value)}
				<label class="relative">
					<input type="checkbox" {value} bind:group={days} class="peer sr-only" />
					<span class="{choice} min-h-tap min-w-tap rounded-chip bg-surface-raised px-3"
						>{label}</span
					>
				</label>
			{/each}
		</fieldset>
	{:else if kind === 'once'}
		<label class="flex flex-col gap-2">
			<span class="text-caption text-ink-muted">On which day (blank means today)</span>
			<input
				type="date"
				bind:value={onceDate}
				class="min-h-tap rounded-control border-2 border-control-line bg-control px-4 text-body"
			/>
		</label>
	{/if}

	{#if !habit}<label class="flex min-h-tap items-center gap-4">
			<input type="checkbox" bind:checked={approval} class="size-tap" />
			<span class="text-body">A grown-up checks it before stars count</span>
		</label>{/if}

	{#if message}<p role="alert" class="text-body font-bold text-danger">{message}</p>{/if}

	<div class="flex gap-4">
		<Button type="submit">Save</Button>
		<Button variant="secondary" onclick={oncancel}>Cancel</Button>
	</div>
</form>
