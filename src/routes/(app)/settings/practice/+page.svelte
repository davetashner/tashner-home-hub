<script lang="ts">
	import { errorMessage, safeFetch } from '#lib/domain/api-error.js';
	import { onMount } from 'svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import { REWARD_EMOJI } from '#lib/domain/emoji.js';

	interface Activity {
		id: string;
		name: string;
		emoji: string | null;
		minutesPerBlock: number;
		starsPerBlock: number;
		dailyStarCap: number;
		memberIds: string[] | null;
		active: boolean;
		sortOrder: number;
	}
	interface Kid {
		id: string;
		name: string;
		role: string;
	}

	let items = $state<Activity[]>([]);
	let kids = $state<Kid[]>([]);
	let loaded = $state(false);
	let message = $state('');
	/** null = form closed; '' = adding; otherwise the id being edited. */
	let editing = $state<string | null>(null);
	let name = $state('');
	let emoji = $state('');
	let minutes = $state(15);
	let stars = $state(1);
	let cap = $state(4);
	let allKids = $state(true);
	let chosen = $state<string[]>([]);

	async function load() {
		const [a, m] = await Promise.all([fetch('/api/practice-activities'), fetch('/api/members')]);
		items = a.ok ? await a.json() : [];
		kids = m.ok ? ((await m.json()) as Kid[]).filter((k) => k.role === 'child') : [];
		loaded = true;
	}
	onMount(load);

	function openForm(a?: Activity) {
		editing = a?.id ?? '';
		name = a?.name ?? '';
		emoji = a?.emoji ?? '';
		minutes = a?.minutesPerBlock ?? 15;
		stars = a?.starsPerBlock ?? 1;
		cap = a?.dailyStarCap ?? 4;
		allKids = a ? a.memberIds === null : true;
		chosen = a?.memberIds ?? [];
		message = '';
	}

	async function send(url: string, method: string, body: object) {
		const res = await safeFetch(url, {
			method,
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		if (!res.ok) {
			message = await errorMessage(res);
			return false;
		}
		return true;
	}

	async function save(e: SubmitEvent) {
		e.preventDefault();
		if (!allKids && chosen.length === 0) {
			message = 'Pick at least one kid, or choose all kids.';
			return;
		}
		const ok = await send(
			editing ? `/api/practice-activities/${editing}` : '/api/practice-activities',
			editing ? 'PATCH' : 'POST',
			{
				name,
				emoji: emoji.trim() || null,
				minutesPerBlock: minutes,
				starsPerBlock: stars,
				dailyStarCap: cap,
				memberIds: allKids ? null : chosen
			}
		);
		if (!ok) return;
		editing = null;
		await load();
	}

	async function toggleActive(a: Activity) {
		if (await send(`/api/practice-activities/${a.id}`, 'PATCH', { active: !a.active }))
			await load();
	}

	async function move(moving: Activity, dir: -1 | 1) {
		// Work from a fresh list so another grown-up's change never leaves ties behind.
		await load();
		const a = items.find((x) => x.id === moving.id);
		if (!a) return;
		const i = items.indexOf(a);
		const other = items[i + dir];
		if (!other) return;
		// Renumber the whole list so ties never leave the order ambiguous.
		const order = items.map((x) => x.id);
		order[i] = other.id;
		order[i + dir] = a.id;
		for (const [n, id] of order.entries()) {
			const cur = items.find((x) => x.id === id)!;
			if (cur.sortOrder !== n)
				await send(`/api/practice-activities/${id}`, 'PATCH', { sortOrder: n });
		}
		await load();
	}

	function who(a: Activity): string {
		if (a.memberIds === null) return 'All kids';
		const names = kids.filter((k) => a.memberIds!.includes(k.id)).map((k) => k.name);
		return names.length ? names.join(', ') : 'No kids';
	}

	const field =
		'min-h-tap w-full rounded-control border-2 border-line bg-surface px-6 text-body text-ink';
	const chip = (on: boolean) =>
		`min-h-tap rounded-control border-2 px-6 text-body font-bold transition-transform duration-75 active:scale-95 ${
			on ? 'border-accent bg-accent-soft' : 'border-line bg-surface'
		}`;
</script>

<svelte:head><title>Reading & practice</title></svelte:head>

<section class="mx-auto flex w-full max-w-5xl flex-col gap-8 p-8 max-sm:p-3 short:gap-4 short:p-3">
	<header class="flex flex-wrap items-center justify-between gap-6">
		<h1 class="text-headline font-extrabold">Reading & practice</h1>
		<Button data-testid="add-activity" onclick={() => openForm()}>Add activity</Button>
	</header>
	<p class="text-body text-ink-muted">
		Kids log minutes themselves and earn stars at the rate you set here, up to a daily limit.
	</p>

	{#if editing !== null}
		<Card elevation="float">
			<form class="flex flex-col gap-6" onsubmit={save} data-testid="activity-form">
				<div class="flex flex-wrap gap-6">
					<label class="flex min-w-64 flex-1 flex-col gap-2 max-sm:min-w-0 max-sm:basis-full">
						<span class="text-caption text-ink-muted">Name</span>
						<input
							class={field}
							bind:value={name}
							maxlength="40"
							required
							data-testid="activity-name"
						/>
					</label>
					<label class="flex flex-col gap-2 max-sm:w-full">
						<span class="text-caption text-ink-muted">Minutes per block</span>
						<input
							class="{field} w-56 max-sm:w-full"
							type="number"
							inputmode="numeric"
							min="1"
							max="240"
							bind:value={minutes}
							required
							data-testid="activity-minutes"
						/>
					</label>
					<label class="flex flex-col gap-2 max-sm:w-full">
						<span class="text-caption text-ink-muted">Stars per block</span>
						<input
							class="{field} w-56 max-sm:w-full"
							type="number"
							inputmode="numeric"
							min="1"
							max="20"
							bind:value={stars}
							required
							data-testid="activity-stars"
						/>
					</label>
					<label class="flex flex-col gap-2 max-sm:w-full">
						<span class="text-caption text-ink-muted">Most stars a day</span>
						<input
							class="{field} w-56 max-sm:w-full"
							type="number"
							inputmode="numeric"
							min="1"
							max="100"
							bind:value={cap}
							required
							data-testid="activity-cap"
						/>
					</label>
				</div>
				<div class="flex flex-col gap-2">
					<span class="text-caption text-ink-muted" id="activity-emoji-label">Emoji</span>
					<div
						class="flex flex-wrap gap-2"
						role="group"
						aria-labelledby="activity-emoji-label"
						data-testid="activity-emoji-grid"
					>
						{#each REWARD_EMOJI as c (c.emoji)}
							<button
								type="button"
								class="flex size-tap items-center justify-center rounded-control border-2 text-title transition-transform duration-75 active:scale-95 {emoji ===
								c.emoji
									? 'border-accent bg-accent-soft'
									: 'border-line bg-surface'}"
								aria-label={c.label}
								aria-pressed={emoji === c.emoji}
								onclick={() => (emoji = emoji === c.emoji ? '' : c.emoji)}
							>
								{c.emoji}
							</button>
						{/each}
					</div>
				</div>
				<div class="flex flex-col gap-2">
					<span class="text-caption text-ink-muted" id="activity-who-label">Who</span>
					<div
						class="flex flex-wrap gap-2"
						role="group"
						aria-labelledby="activity-who-label"
						data-testid="activity-who"
					>
						<button
							type="button"
							class={chip(allKids)}
							aria-pressed={allKids}
							onclick={() => (allKids = !allKids)}
							data-testid="activity-all-kids"
						>
							All kids
						</button>
						{#if !allKids}
							{#each kids as k (k.id)}
								<button
									type="button"
									class={chip(chosen.includes(k.id))}
									aria-pressed={chosen.includes(k.id)}
									onclick={() =>
										(chosen = chosen.includes(k.id)
											? chosen.filter((x) => x !== k.id)
											: [...chosen, k.id])}
									data-testid="activity-kid"
								>
									{k.name}
								</button>
							{/each}
						{/if}
					</div>
				</div>
				{#if message}<p class="text-danger" role="alert">{message}</p>{/if}
				<div class="flex gap-4">
					<Button type="submit" data-testid="activity-save">Save</Button>
					<Button variant="secondary" onclick={() => (editing = null)}>Cancel</Button>
				</div>
			</form>
		</Card>
	{/if}

	{#if loaded && items.length === 0}
		<p class="text-lead text-ink-muted">No activities yet. Add the first one.</p>
	{/if}

	<ul class="flex flex-col gap-4">
		{#each items as a (a.id)}
			<li data-testid="activity-row">
				<Card class="flex flex-wrap items-center gap-x-6 gap-y-4 !p-6 max-sm:!p-4">
					<span class="w-24 text-center text-headline" aria-hidden="true">{a.emoji ?? '⭐'}</span>
					<span class="flex min-w-64 flex-1 flex-col max-sm:min-w-0 max-sm:basis-full">
						<span class="flex flex-wrap items-center gap-3 text-lead font-bold">
							{a.name}
							{#if !a.active}<Badge>Off</Badge>{/if}
						</span>
						<span class="text-body text-ink-muted">
							{a.starsPerBlock}
							{a.starsPerBlock === 1 ? 'star' : 'stars'} per {a.minutesPerBlock} min, up to
							{a.dailyStarCap} a day. {who(a)}
						</span>
					</span>
					<span class="ml-auto flex flex-wrap items-center justify-end gap-2">
						<Button variant="ghost" onclick={() => move(a, -1)} aria-label="Move {a.name} up">
							Up
						</Button>
						<Button variant="ghost" onclick={() => move(a, 1)} aria-label="Move {a.name} down">
							Down
						</Button>
						<Button variant="secondary" onclick={() => openForm(a)} aria-label="Edit {a.name}">
							Edit
						</Button>
						<Button
							variant="ghost"
							onclick={() => toggleActive(a)}
							aria-label="{a.active ? 'Turn off' : 'Turn on'} {a.name}"
						>
							{a.active ? 'Turn off' : 'Turn on'}
						</Button>
					</span>
				</Card>
			</li>
		{/each}
	</ul>
</section>
