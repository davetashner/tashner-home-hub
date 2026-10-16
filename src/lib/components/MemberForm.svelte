<script lang="ts">
	import { MEMBER_COLORS, type MemberColor } from '#lib/domain/member-colors.js';
	import type { Member, MemberInput, Role } from '#lib/server/domain/members.js';
	import Button from './ui/Button.svelte';
	import MemberAvatar from './MemberAvatar.svelte';

	interface Props {
		member?: Member;
		/** Saves the member; resolves to an error message, or undefined on success. */
		onsave: (input: MemberInput) => Promise<string | undefined>;
		oncancel: () => void;
	}

	let { member, onsave, oncancel }: Props = $props();

	const AVATARS = ['🦊', '🐢', '🐼', '🦁', '🐸', '🦄', '🚀', '⚽', '🎨', '🌻', '🍕', '⭐'];
	const colorClass: Record<MemberColor, string> = {
		'member-1': 'bg-member-1',
		'member-2': 'bg-member-2',
		'member-3': 'bg-member-3',
		'member-4': 'bg-member-4',
		'member-5': 'bg-member-5',
		'member-6': 'bg-member-6'
	};

	// Form fields start from the member being edited, then belong to the form.
	// svelte-ignore state_referenced_locally
	let name = $state(member?.name ?? '');
	// svelte-ignore state_referenced_locally
	let role = $state<Role>(member?.role ?? 'adult');
	let message = $state<string>();
	// svelte-ignore state_referenced_locally
	let color = $state<MemberColor>(member?.color ?? MEMBER_COLORS[0]);
	// svelte-ignore state_referenced_locally
	let avatar = $state(member?.avatar ?? '');

	const choice =
		'press flex items-center justify-center border-2 border-line text-lead peer-checked:border-ink peer-checked:ring-4 peer-checked:ring-ink peer-focus-visible:outline-4 peer-focus-visible:outline-accent';
</script>

<form
	class="flex flex-col gap-6"
	data-testid="member-form"
	onsubmit={async (e) => {
		e.preventDefault();
		message = await onsave({ name, role, color, avatar: avatar || null });
	}}
>
	<div class="flex flex-wrap items-center gap-6">
		<MemberAvatar {name} {color} avatar={avatar || null} size="lg" />
		<label class="flex min-w-48 flex-1 flex-col gap-2 text-caption text-ink-muted">
			Name
			<input
				name="name"
				bind:value={name}
				required
				maxlength="40"
				autocomplete="off"
				class="min-h-tap rounded-control border-2 border-line bg-surface px-4 text-body text-ink"
			/>
		</label>
	</div>

	<fieldset class="flex min-w-0 flex-wrap gap-3">
		<legend class="mb-2 text-caption text-ink-muted">Who is this?</legend>
		{#each [['adult', 'Grown-up'], ['child', 'Kid']] as [value, label] (value)}
			<label class="relative">
				<input type="radio" name="role" {value} bind:group={role} class="peer sr-only" />
				<span class="{choice} min-h-tap rounded-control bg-surface-raised px-8 text-body"
					>{label}</span
				>
			</label>
		{/each}
	</fieldset>

	<fieldset class="flex min-w-0 flex-wrap gap-3">
		<legend class="mb-2 text-caption text-ink-muted">Color</legend>
		{#each MEMBER_COLORS as value (value)}
			<label class="relative">
				<input
					type="radio"
					name="color"
					{value}
					bind:group={color}
					class="peer sr-only"
					aria-label={value.replace('member-', 'Color ')}
				/>
				<span class="{choice} size-tap rounded-chip {colorClass[value]}"></span>
			</label>
		{/each}
	</fieldset>

	<fieldset class="flex min-w-0 flex-wrap gap-3">
		<legend class="mb-2 text-caption text-ink-muted">Picture</legend>
		<label class="relative">
			<input type="radio" name="avatar" value="" bind:group={avatar} class="peer sr-only" />
			<span class="{choice} min-h-tap min-w-tap rounded-chip bg-surface-raised px-4 text-body"
				>Initial</span
			>
		</label>
		{#each AVATARS as value (value)}
			<label class="relative">
				<input type="radio" name="avatar" {value} bind:group={avatar} class="peer sr-only" />
				<span class="{choice} size-tap rounded-chip bg-surface-raised">{value}</span>
			</label>
		{/each}
	</fieldset>

	{#if message}<p role="alert" class="text-body font-bold text-danger">{message}</p>{/if}

	<div class="flex gap-4">
		<Button type="submit">Save</Button>
		<Button variant="secondary" onclick={oncancel}>Cancel</Button>
	</div>
</form>
