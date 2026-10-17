<script lang="ts">
	import { MEMBER_COLORS, type MemberColor } from '#lib/domain/member-colors.js';
	import MemberAvatar from '#lib/components/MemberAvatar.svelte';
	import PinPad, { type PinResult } from '#lib/components/PinPad.svelte';
	import Button from '#lib/components/ui/Button.svelte';

	const AVATARS = ['🦊', '🐢', '🐼', '🦁', '🐸', '🦄', '🚀', '⚽', '🎨', '🌻', '🍕', '⭐'];
	const colorClass: Record<MemberColor, string> = {
		'member-1': 'bg-member-1',
		'member-2': 'bg-member-2',
		'member-3': 'bg-member-3',
		'member-4': 'bg-member-4',
		'member-5': 'bg-member-5',
		'member-6': 'bg-member-6'
	};
	const choice =
		'press flex items-center justify-center border-2 border-line text-lead peer-checked:border-ink peer-checked:ring-4 peer-checked:ring-ink peer-focus-visible:outline-4 peer-focus-visible:outline-accent';

	let step = $state<1 | 2 | 3>(1);
	let name = $state('');
	let color = $state<MemberColor>(MEMBER_COLORS[0]);
	let avatar = $state('');
	let firstPin = $state('');
	let notice = $state('');

	const titles = {
		1: 'Welcome to your hub',
		2: 'Choose a PIN',
		3: 'Type it once more'
	} as const;
	const hints = {
		1: 'Let’s start with you. You’ll add the rest of the family next.',
		2: 'Four to six digits. Only grown-ups use it to open settings.',
		3: 'Just to be sure we got it right.'
	} as const;

	function choosePin(pin: string): Promise<PinResult> {
		firstPin = pin;
		notice = '';
		step = 3;
		return Promise.resolve({ ok: true });
	}

	async function confirmPin(pin: string): Promise<PinResult> {
		if (pin !== firstPin) {
			firstPin = '';
			step = 2;
			notice = 'Those PINs did not match. Let’s try again.';
			return { ok: true };
		}
		const response = await fetch('/api/setup', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name, color, avatar: avatar || null, pin, remember: true })
		});
		if (response.ok) {
			// Full load so the new session cookie reaches server-rendered pages.
			window.location.assign('/settings/family');
			return { ok: true };
		}
		const body = (await response.json().catch(() => ({}))) as { message?: string };
		firstPin = '';
		step = 2;
		notice = body.message ?? 'Something went wrong. Please try again.';
		return { ok: true };
	}
</script>

<svelte:head><title>Set up your hub</title></svelte:head>

<main
	class="flex min-h-dvh flex-col items-center justify-center gap-10 bg-surface p-safe-8 text-ink"
	data-testid="setup"
	data-step={step}
>
	<header class="flex flex-col items-center gap-3 text-center">
		<h1 class="text-headline font-extrabold">{titles[step]}</h1>
		<p class="max-w-3xl text-lead text-ink-muted">{hints[step]}</p>
		<p class="text-caption font-bold text-ink-muted" aria-label="Step {step} of 3">
			Step {step} of 3
		</p>
	</header>

	{#if step === 1}
		<form
			class="flex w-full max-w-3xl flex-col gap-8 rounded-sheet bg-surface-raised p-8 shadow-float"
			data-testid="setup-profile"
			onsubmit={(e) => {
				e.preventDefault();
				if (name.trim()) step = 2;
			}}
		>
			<div class="flex items-center gap-6">
				<MemberAvatar {name} {color} avatar={avatar || null} size="lg" />
				<label class="flex flex-1 flex-col gap-2 text-caption text-ink-muted">
					Your name
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

			<fieldset class="flex flex-wrap gap-3">
				<legend class="mb-2 text-caption text-ink-muted">Your color</legend>
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

			<fieldset class="flex flex-wrap gap-3">
				<legend class="mb-2 text-caption text-ink-muted">Your picture</legend>
				<label class="relative">
					<input type="radio" name="avatar" value="" bind:group={avatar} class="peer sr-only" />
					<span class="{choice} min-h-tap min-w-tap rounded-chip bg-surface px-4 text-body"
						>Initial</span
					>
				</label>
				{#each AVATARS as value (value)}
					<label class="relative">
						<input type="radio" name="avatar" {value} bind:group={avatar} class="peer sr-only" />
						<span class="{choice} size-tap rounded-chip bg-surface">{value}</span>
					</label>
				{/each}
			</fieldset>

			<Button type="submit" disabled={!name.trim()} class="self-end">Next</Button>
		</form>
	{:else}
		{#if notice}
			<p
				role="alert"
				class="text-center text-body font-bold text-danger"
				data-testid="setup-notice"
			>
				{notice}
			</p>
		{/if}
		{#key step}
			<PinPad onsubmit={step === 2 ? choosePin : confirmPin} />
		{/key}
		<Button
			variant="ghost"
			onclick={() => {
				notice = '';
				step = step === 3 ? 2 : 1;
			}}>Back</Button
		>
	{/if}
</main>
