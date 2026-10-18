<script lang="ts">
	import { errorMessage, safeFetch } from '#lib/domain/api-error.js';
	import { onMount } from 'svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import {
		GAME_TITLE_MAX,
		MAX_GAMES,
		isPrivateGameUrl,
		moveGame,
		type Game
	} from '#lib/domain/games.js';

	const JSON_HEADERS = { 'content-type': 'application/json' };

	let items = $state<Game[]>([]);
	let loaded = $state(false);
	let message = $state('');
	/** null = form closed; '' = adding; otherwise the id being edited. */
	let editing = $state<string | null>(null);
	let title = $state('');
	let url = $state('');
	let image = $state('');
	const lanHost = $derived(isPrivateGameUrl(url));

	async function load() {
		const res = await fetch('/api/games');
		items = res.ok ? await res.json() : [];
		loaded = true;
	}
	onMount(load);

	function openForm(g?: Game) {
		editing = g?.id ?? '';
		title = g?.title ?? '';
		url = g?.url ?? '';
		image = g?.image ?? '';
		message = '';
	}

	async function save(e: SubmitEvent) {
		e.preventDefault();
		const res = await safeFetch(editing ? `/api/games/${editing}` : '/api/games', {
			method: editing ? 'PATCH' : 'POST',
			headers: JSON_HEADERS,
			body: JSON.stringify({ title, url, image: image.trim() || null })
		});
		if (!res.ok) {
			message = await errorMessage(res);
			return;
		}
		editing = null;
		await load();
	}

	async function remove(g: Game) {
		items = items.filter((x) => x.id !== g.id);
		await fetch(`/api/games/${g.id}`, { method: 'DELETE', headers: JSON_HEADERS, body: '{}' });
		await load();
	}

	/** Optimistic: the list reorders first, then the server; a reload shows the truth. */
	async function move(g: Game, step: -1 | 1) {
		items = moveGame(items, g.id, step);
		await fetch(`/api/games/${g.id}`, {
			method: 'PATCH',
			headers: JSON_HEADERS,
			body: JSON.stringify({ move: step })
		});
		await load();
	}

	const field =
		'min-h-tap w-full rounded-control border-2 border-line bg-surface px-6 text-body text-ink';
</script>

<svelte:head><title>Games settings</title></svelte:head>

<section class="mx-auto flex w-full max-w-5xl flex-col gap-8 p-8 max-sm:p-3 short:gap-4 short:p-3">
	<header class="flex flex-wrap items-center justify-between gap-6">
		<h1 class="text-headline font-extrabold">Games</h1>
		{#if items.length < MAX_GAMES}
			<Button data-testid="add-game" onclick={() => openForm()}>Add game</Button>
		{/if}
	</header>

	{#if editing !== null}
		<Card elevation="float">
			<form class="flex flex-col gap-6" onsubmit={save} data-testid="game-form">
				<label class="flex flex-col gap-2">
					<span class="text-caption text-ink-muted">Name</span>
					<input
						class={field}
						bind:value={title}
						maxlength={GAME_TITLE_MAX}
						required
						data-testid="game-title"
					/>
				</label>
				<label class="flex flex-col gap-2">
					<span class="text-caption text-ink-muted">Game address (https://...)</span>
					<input
						class={field}
						type="url"
						inputmode="url"
						bind:value={url}
						required
						data-testid="game-url"
					/>
					{#if lanHost}
						<p class="text-caption text-ink" role="note" data-testid="game-lan-warning">
							This address is on your home network. Only add game servers you trust.
						</p>
					{/if}
				</label>
				<label class="flex flex-col gap-2">
					<span class="text-caption text-ink-muted">Preview picture address (optional)</span>
					<input
						class={field}
						type="url"
						inputmode="url"
						bind:value={image}
						data-testid="game-image"
					/>
				</label>
				{#if message}<p class="text-danger" role="alert">{message}</p>{/if}
				<div class="flex gap-4">
					<Button type="submit" data-testid="game-save">Save</Button>
					<Button variant="secondary" onclick={() => (editing = null)}>Cancel</Button>
				</div>
			</form>
		</Card>
	{/if}

	{#if loaded && items.length === 0}
		<p class="text-lead text-ink-muted">No games yet. Add the first one.</p>
	{/if}

	<ul class="flex flex-col gap-4">
		{#each items as g, i (g.id)}
			<li data-testid="game-row">
				<Card class="flex flex-wrap items-center gap-4 !p-6 max-sm:!p-4">
					<span class="flex min-w-48 flex-1 flex-col">
						<span class="text-lead font-bold">{g.title}</span>
						<span class="text-caption break-all text-ink-muted">{g.url}</span>
					</span>
					<Button
						variant="secondary"
						disabled={i === 0}
						onclick={() => move(g, -1)}
						aria-label="Move {g.title} up"
					>
						↑
					</Button>
					<Button
						variant="secondary"
						disabled={i === items.length - 1}
						onclick={() => move(g, 1)}
						aria-label="Move {g.title} down"
					>
						↓
					</Button>
					<Button variant="secondary" onclick={() => openForm(g)} aria-label="Edit {g.title}">
						Edit
					</Button>
					<Button variant="ghost" onclick={() => remove(g)} aria-label="Delete {g.title}">
						Delete
					</Button>
				</Card>
			</li>
		{/each}
	</ul>
</section>
