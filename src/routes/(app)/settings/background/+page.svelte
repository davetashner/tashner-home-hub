<script lang="ts">
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import { wave } from '#lib/components/shell/wave-state.svelte.js';
	import { WAVE_CHOICES, WAVE_LABELS, type WaveChoice } from '#lib/domain/wave-background.js';

	let message = $state('');
	let edits = 0;

	function choose(choice: WaveChoice) {
		if (wave.choice === choice) return;
		// Optimistic: the background changes on the tap, the save follows.
		const before = wave.choice;
		const at = ++edits;
		wave.choice = choice;
		message = '';
		const fail = () => {
			message = 'Could not save. Try again.';
			if (at === edits) wave.choice = before;
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
				Auto is Dusk by day and Night with the night theme. Night shows with the night theme.
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
	{#if message}<p role="alert" class="text-body text-danger">{message}</p>{/if}
</section>
