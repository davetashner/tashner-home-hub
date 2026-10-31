<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';

	let enabled = $state(true);
	let message = $state('');
	let edits = 0;

	onMount(() => {
		const at = edits;
		void fetch('/api/settings/drawing-prompts')
			.then(async (res) => {
				const body = res.ok ? await res.json() : null;
				if (body && at === edits) enabled = body.enabled !== false;
			})
			.catch(() => {});
	});

	function change(next: boolean) {
		const before = enabled;
		const at = ++edits;
		enabled = next;
		message = '';
		const fail = () => {
			message = 'Could not save. Try again.';
			if (at === edits) enabled = before;
		};
		void fetch('/api/settings/drawing-prompts', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ enabled: next })
		})
			.then((res) => {
				if (!res.ok) fail();
			})
			.catch(fail);
	}

	const choices = [
		{ on: true, label: 'On' },
		{ on: false, label: 'Off' }
	];
</script>

<svelte:head>
	<title>Drawing · Settings · Home Hub</title>
</svelte:head>

<section class="mx-auto flex w-full max-w-4xl flex-col gap-8 p-8 max-sm:p-3 short:gap-4 short:p-3">
	<h1 class="text-headline font-extrabold">Drawing</h1>
	<Card>
		<div class="flex flex-wrap items-center justify-between gap-6">
			<div class="flex flex-col gap-1">
				<h2 class="text-title font-bold">Daily drawing prompt</h2>
				<p class="text-body text-ink-muted">
					A fun idea at the top of the drawing board, new every day.
				</p>
			</div>
			<div class="flex flex-wrap gap-4" role="group" aria-label="Daily drawing prompt">
				{#each choices as c (c.label)}
					<Button
						variant={enabled === c.on ? 'primary' : 'secondary'}
						aria-pressed={enabled === c.on}
						onclick={() => enabled !== c.on && change(c.on)}>{c.label}</Button
					>
				{/each}
			</div>
		</div>
	</Card>
	{#if message}<p role="alert" class="text-body text-danger">{message}</p>{/if}
</section>
