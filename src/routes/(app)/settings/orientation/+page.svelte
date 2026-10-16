<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import {
		ROTATION_CHOICES,
		isRotation,
		orientationOf,
		type Orientation,
		type Rotation
	} from '#lib/domain/orientation.js';

	let rotation = $state<Rotation>('normal');
	let message = $state('');
	// Each change stamps a number, so a stale load or a late failure can't undo a newer change.
	let edits = 0;

	onMount(() => {
		const at = edits;
		void fetch('/api/settings/orientation')
			.then(async (res) => {
				const body = res.ok ? ((await res.json()) as { rotation?: unknown }) : null;
				if (body && isRotation(body.rotation) && at === edits) rotation = body.rotation;
			})
			.catch(() => {});
	});

	function choose(next: Rotation) {
		if (next === rotation) return;
		// Optimistic: the buttons update before the save lands.
		const before = rotation;
		const at = ++edits;
		rotation = next;
		message = '';
		const fail = () => {
			message = 'Could not save. Try again.';
			if (at === edits) rotation = before;
		};
		void fetch('/api/settings/orientation', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ rotation: next })
		})
			.then((res) => {
				if (!res.ok) fail();
			})
			.catch(fail);
	}

	const groups: { orientation: Orientation; title: string }[] = [
		{ orientation: 'landscape', title: 'Wide (landscape)' },
		{ orientation: 'portrait', title: 'Tall (portrait)' }
	];
</script>

<svelte:head>
	<title>Orientation · Settings · Home Hub</title>
</svelte:head>

<section class="mx-auto flex w-full max-w-4xl flex-col gap-8 p-8 max-sm:p-3">
	<h1 class="text-headline font-extrabold">Orientation</h1>
	<p class="text-body text-ink-muted" data-testid="orientation-summary">
		The wall screen is set up {orientationOf(rotation)}. The display agent on the wall screen turns
		the picture and the touch to match; the layouts follow the screen's shape on their own.
	</p>
	{#each groups as g (g.orientation)}
		<Card>
			<div class="flex flex-col gap-6">
				<h2 class="text-title font-bold">{g.title}</h2>
				<div class="flex flex-wrap gap-4" role="group" aria-label={g.title}>
					{#each ROTATION_CHOICES[g.orientation] as c (c.rotation)}
						<Button
							variant={rotation === c.rotation ? 'primary' : 'secondary'}
							aria-pressed={rotation === c.rotation}
							onclick={() => choose(c.rotation)}>{c.label}</Button
						>
					{/each}
				</div>
				<ul class="flex flex-col gap-1 text-body text-ink-muted">
					{#each ROTATION_CHOICES[g.orientation] as c (c.rotation)}
						<li>{c.label}: {c.hint}</li>
					{/each}
				</ul>
			</div>
		</Card>
	{/each}
	{#if message}<p role="alert" class="text-body text-danger">{message}</p>{/if}
</section>
