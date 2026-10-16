<script lang="ts">
	import type { ChoreInput, ChoreView, Weekday } from '#lib/server/domain/chores.js';
	import type { Member } from '#lib/server/domain/members.js';
	import Button from './ui/Button.svelte';
	import MemberAvatar from './MemberAvatar.svelte';

	interface Props {
		chore?: ChoreView;
		members: Member[];
		/** Saves the chore; resolves to an error message, or undefined on success. */
		onsave: (input: ChoreInput) => Promise<string | undefined>;
		oncancel: () => void;
	}

	let { chore, members, onsave, oncancel }: Props = $props();

	const ICONS = ['🍽️', '🧸', '🛏️', '🦷', '🧺', '🐶', '🪴', '📚', '🧹', '🎒', '🚿', '🗑️'];
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
		['monthly', 'Monthly']
	] as const;
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
	let kind = $state<string>(chore?.schedule.type ?? 'daily');
	/* svelte-ignore state_referenced_locally */
	let days = $state<Weekday[]>(chore?.schedule.type === 'weekdays' ? chore.schedule.days : []);
	/* svelte-ignore state_referenced_locally */
	let onceDate = $state(chore?.schedule.type === 'once' ? chore.schedule.start : '');
	/* svelte-ignore state_referenced_locally */
	let approval = $state(chore?.requiresApproval ?? true);
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
					: { type: kind };
		message = await onsave({
			title,
			icon: icon || null,
			stars,
			memberIds,
			timeOfDay,
			requiresApproval: approval,
			schedule: schedule as ChoreInput['schedule']
		});
	}
</script>

<form onsubmit={submit} class="flex flex-col gap-6" data-testid="chore-form">
	<label class="flex flex-col gap-2">
		<span class="text-caption text-ink-muted">Chore</span>
		<input
			bind:value={title}
			maxlength="60"
			required
			class="min-h-tap rounded-control border-2 border-line bg-surface-raised px-4 text-body"
		/>
	</label>

	<fieldset class="flex flex-wrap gap-3">
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

	<div class="flex items-center gap-4">
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
	</div>

	<fieldset class="flex flex-wrap gap-3">
		<legend class="mb-2 text-caption text-ink-muted">Who</legend>
		{#each members as m (m.id)}
			<label class="relative flex flex-col items-center gap-1">
				<input type="checkbox" value={m.id} bind:group={memberIds} class="peer sr-only" />
				<span
					class="press flex items-center gap-3 rounded-chip border-2 border-line bg-surface-raised p-2 pr-4 peer-checked:border-ink peer-checked:ring-4 peer-checked:ring-ink peer-focus-visible:outline-4 peer-focus-visible:outline-accent"
				>
					<MemberAvatar name={m.name} color={m.color} avatar={m.avatar} size="sm" />
					<span class="text-body">{m.name}</span>
				</span>
			</label>
		{/each}
	</fieldset>

	<fieldset class="flex flex-wrap gap-3">
		<legend class="mb-2 text-caption text-ink-muted">When in the day</legend>
		{#each TIMES as [value, label] (value)}
			<label class="relative">
				<input type="radio" name="timeOfDay" {value} bind:group={timeOfDay} class="peer sr-only" />
				<span class="{choice} min-h-tap rounded-chip bg-surface-raised px-6">{label}</span>
			</label>
		{/each}
	</fieldset>

	<fieldset class="flex flex-wrap gap-3">
		<legend class="mb-2 text-caption text-ink-muted">How often</legend>
		{#each KINDS as [value, label] (value)}
			<label class="relative">
				<input type="radio" name="kind" {value} bind:group={kind} class="peer sr-only" />
				<span class="{choice} min-h-tap rounded-chip bg-surface-raised px-6">{label}</span>
			</label>
		{/each}
	</fieldset>

	{#if kind === 'weekdays'}
		<fieldset class="flex flex-wrap gap-3" aria-label="Days of the week">
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
				class="min-h-tap rounded-control border-2 border-line bg-surface-raised px-4 text-body"
			/>
		</label>
	{/if}

	<label class="flex min-h-tap items-center gap-4">
		<input type="checkbox" bind:checked={approval} class="size-tap" />
		<span class="text-body">A grown-up checks it before stars count</span>
	</label>

	{#if message}<p role="alert" class="text-body font-bold text-danger">{message}</p>{/if}

	<div class="flex gap-4">
		<Button type="submit">Save</Button>
		<Button variant="secondary" onclick={oncancel}>Cancel</Button>
	</div>
</form>
