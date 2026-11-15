<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import { CHALLENGE_MAX_LENGTH, type Challenge } from '#lib/domain/drawing-challenges.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let enabled = $state(true);
	let starsOn = $state(true);
	let gameOn = $state(true);
	let gameEdits = 0;
	let message = $state('');
	let edits = 0;
	let starEdits = 0;

	// Grown-up challenges (hub-t27j.11): one prompt per kid, replacing the daily one on their board.
	let challenges = $state<Challenge[]>([]);
	let kidId = $state('');
	let text = $state('');
	const field =
		'min-h-tap w-full rounded-control border-2 border-line bg-surface px-6 text-body text-ink';
	const post = (method: string, body: unknown) =>
		fetch('/api/settings/drawing-challenges', {
			method,
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
	async function addChallenge(e: SubmitEvent) {
		e.preventDefault();
		const memberId = kidId || data.kids[0]?.id;
		if (!memberId || !text.trim()) return;
		message = '';
		try {
			const res = await post('POST', { memberId, text });
			if (!res.ok) throw new Error();
			const made = (await res.json()) as Challenge;
			challenges = [...challenges.filter((c) => c.memberId !== memberId), made];
			text = '';
		} catch {
			message = 'Could not save the challenge. Try again.';
		}
	}
	async function removeChallenge(c: Challenge) {
		message = '';
		const before = challenges;
		challenges = challenges.filter((x) => x.id !== c.id);
		try {
			const res = await post('DELETE', { id: c.id });
			if (!res.ok) throw new Error();
		} catch {
			challenges = before;
			message = 'Could not remove the challenge. Try again.';
		}
	}
	const kidName = (id: string) => data.kids.find((k) => k.id === id)?.name ?? 'A kid';

	onMount(() => {
		void fetch('/api/settings/drawing-challenges')
			.then(async (res) => {
				const body: unknown = res.ok ? await res.json() : null;
				if (Array.isArray(body)) challenges = body as Challenge[];
			})
			.catch(() => {});
		const at = edits;
		void fetch('/api/settings/drawing-prompts')
			.then(async (res) => {
				const body = res.ok ? await res.json() : null;
				if (body && at === edits) enabled = body.enabled !== false;
			})
			.catch(() => {});
		const starAt = starEdits;
		void fetch('/api/settings/drawing-stars')
			.then(async (res) => {
				const body = res.ok ? await res.json() : null;
				if (body && starAt === starEdits) starsOn = body.enabled !== false;
			})
			.catch(() => {});
		const gameAt = gameEdits;
		void fetch('/api/settings/drawing-game-stars')
			.then(async (res) => {
				const body = res.ok ? await res.json() : null;
				if (body && gameAt === gameEdits) gameOn = body.enabled !== false;
			})
			.catch(() => {});
	});

	function changeGame(next: boolean) {
		const before = gameOn;
		const at = ++gameEdits;
		gameOn = next;
		message = '';
		const fail = () => {
			message = 'Could not save. Try again.';
			if (at === gameEdits) gameOn = before;
		};
		void fetch('/api/settings/drawing-game-stars', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ enabled: next })
		})
			.then((res) => {
				if (!res.ok) fail();
			})
			.catch(fail);
	}

	function changeStars(next: boolean) {
		const before = starsOn;
		const at = ++starEdits;
		starsOn = next;
		message = '';
		const fail = () => {
			message = 'Could not save. Try again.';
			if (at === starEdits) starsOn = before;
		};
		void fetch('/api/settings/drawing-stars', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ enabled: next })
		})
			.then((res) => {
				if (!res.ok) fail();
			})
			.catch(fail);
	}

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

	const starChoices = [
		{ on: true, label: 'Earn stars' },
		{ on: false, label: 'No stars' }
	];
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
	<Card>
		<div class="flex flex-wrap items-center justify-between gap-6">
			<div class="flex flex-col gap-1">
				<h2 class="text-title font-bold">Stars for drawing the prompt</h2>
				<p class="text-body text-ink-muted">
					Posting a drawing made from the daily prompt earns a star, once a day.
				</p>
			</div>
			<div class="flex flex-wrap gap-4" role="group" aria-label="Stars for drawing the prompt">
				{#each starChoices as c (c.label)}
					<Button
						variant={starsOn === c.on ? 'primary' : 'secondary'}
						aria-pressed={starsOn === c.on}
						data-testid="drawing-stars-{c.on ? 'on' : 'off'}"
						onclick={() => starsOn !== c.on && changeStars(c.on)}>{c.label}</Button
					>
				{/each}
			</div>
		</div>
	</Card>
	<Card>
		<div class="flex flex-wrap items-center justify-between gap-6">
			<div class="flex flex-col gap-1">
				<h2 class="text-title font-bold">Stars for the guess game</h2>
				<p class="text-body text-ink-muted">
					When a guess is right in Draw and guess, both kids playing earn a star, once per round.
				</p>
			</div>
			<div class="flex flex-wrap gap-4" role="group" aria-label="Stars for the guess game">
				{#each starChoices as c (c.label)}
					<Button
						variant={gameOn === c.on ? 'primary' : 'secondary'}
						aria-pressed={gameOn === c.on}
						data-testid="game-stars-{c.on ? 'on' : 'off'}"
						onclick={() => gameOn !== c.on && changeGame(c.on)}>{c.label}</Button
					>
				{/each}
			</div>
		</div>
	</Card>
	<Card>
		<div class="flex flex-col gap-6">
			<div class="flex flex-col gap-1">
				<h2 class="text-title font-bold">Challenge a kid</h2>
				<p class="text-body text-ink-muted">
					A drawing idea just for one kid. It shows on the drawing board instead of the daily prompt
					until they post a drawing or tap Done.
				</p>
			</div>
			{#if data.kids.length}
				<form
					class="flex flex-wrap items-end gap-4"
					onsubmit={addChallenge}
					data-testid="challenge-form"
				>
					<label class="flex flex-col gap-2">
						<span class="text-caption text-ink-muted">Kid</span>
						<select class={field} bind:value={kidId} data-testid="challenge-kid">
							{#each data.kids as k (k.id)}
								<option value={k.id}>{k.name}</option>
							{/each}
						</select>
					</label>
					<label class="flex min-w-64 flex-1 flex-col gap-2 max-sm:min-w-0 max-sm:basis-full">
						<span class="text-caption text-ink-muted">Challenge</span>
						<input
							class={field}
							bind:value={text}
							maxlength={CHALLENGE_MAX_LENGTH}
							placeholder="Draw what you want for dinner Friday"
							required
							data-testid="challenge-text"
						/>
					</label>
					<Button type="submit" data-testid="challenge-add">Set challenge</Button>
				</form>
			{:else}
				<p class="text-body text-ink-muted">Add a kid in Family settings first.</p>
			{/if}
			{#if challenges.length}
				<ul class="flex flex-col gap-3" data-testid="challenge-list">
					{#each challenges as c (c.id)}
						<li
							class="flex flex-wrap items-center justify-between gap-4"
							data-testid="challenge-row"
						>
							<p class="min-w-0 flex-1 text-body">
								<span class="font-bold">{kidName(c.memberId)}:</span>
								{c.text}
							</p>
							<Button
								variant="secondary"
								onclick={() => removeChallenge(c)}
								data-testid="challenge-remove">Remove</Button
							>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</Card>
	{#if message}<p role="alert" class="text-body text-danger">{message}</p>{/if}
</section>
