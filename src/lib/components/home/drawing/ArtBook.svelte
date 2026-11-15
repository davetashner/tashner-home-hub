<script lang="ts">
	import { page } from '$app/state';
	import Button from '#lib/components/ui/Button.svelte';
	import MemberAvatar from '#lib/components/MemberAvatar.svelte';
	import { isMemberColor, type MemberColor } from '#lib/domain/member-colors.js';
	import {
		groupByMonth,
		parseArtEntries,
		pick,
		stepMonth,
		thenAndNow,
		type ArtEntry
	} from '#lib/domain/drawing-art-book.js';
	import { toolBtn as btn } from './tool-btn.js';

	interface Person {
		id: string;
		name: string;
		color: string;
		avatar: string | null;
	}
	interface Props {
		people: Person[];
		onback: () => void;
	}
	let { people, onback }: Props = $props();

	const memberColor = (c: string): MemberColor => (isMemberColor(c) ? c : 'member-1');

	let who = $state<Person | null>(null);
	/** null while loading. */
	let entries = $state<ArtEntry[] | null>(null);
	let comparing = $state(false);
	let thenKey = $state('');
	let nowKey = $state('');

	const adult = $derived(page.data.adult === true);

	/** Adults only: takes the drawing out of the book. The tile goes first, the server catches up. */
	async function removeDrawing(d: ArtEntry) {
		const before = entries;
		entries = (entries ?? []).filter((e) => e.id !== d.id);
		try {
			const res = await fetch(`/api/drawings/posted/${encodeURIComponent(d.id)}`, {
				method: 'DELETE',
				headers: { 'content-type': 'application/json' },
				body: '{}'
			});
			if (!res.ok) entries = before;
		} catch {
			entries = before;
		}
	}

	const months = $derived(groupByMonth(entries ?? []));
	const pair = $derived(thenAndNow(entries ?? []));

	async function open(p: Person) {
		who = p;
		entries = null;
		comparing = false;
		try {
			const res = await fetch(`/api/drawings/posted?memberId=${encodeURIComponent(p.id)}`);
			entries = res.ok ? parseArtEntries(await res.json()) : [];
		} catch {
			entries = [];
		}
		thenKey = months[months.length - 1]?.key ?? '';
		nowKey = months[0]?.key ?? '';
	}

	/** Back steps out of compare, then out of one kid's book, then out of the art book. */
	function back() {
		if (comparing) comparing = false;
		else if (who) who = null;
		else onback();
	}

	const thenPick = $derived(
		pick(
			months.find((m) => m.key === thenKey),
			'then'
		)
	);
	const nowPick = $derived(
		pick(
			months.find((m) => m.key === nowKey),
			'now'
		)
	);
</script>

{#if !who}
	<p class="w-full text-body font-extrabold">Whose art book?</p>
	<div class="flex flex-wrap gap-3" data-testid="art-people">
		{#each people as p (p.id)}
			<button
				type="button"
				class="flex min-h-tap-kid items-center gap-3 rounded-control border-2 border-line bg-surface-raised px-3 text-body font-extrabold active:scale-95"
				data-testid="art-person"
				onclick={() => void open(p)}
			>
				<MemberAvatar name={p.name} color={memberColor(p.color)} avatar={p.avatar} size="kid" />
				<span>{p.name}</span>
			</button>
		{/each}
	</div>
{:else if comparing && pair}
	<p class="w-full text-body font-extrabold">Then and now</p>
	<div class="flex w-full flex-wrap gap-3" data-testid="art-compare">
		{#each [{ side: 'Then', key: thenKey, shot: thenPick }, { side: 'Now', key: nowKey, shot: nowPick }] as s (s.side)}
			{@const isThen = s.side === 'Then'}
			<div class="flex flex-1 flex-col items-center gap-2" data-testid="art-side-{s.side}">
				<div class="flex items-center gap-2">
					<button
						type="button"
						class="{btn} border-line bg-surface"
						aria-label="{s.side}: earlier month"
						data-testid="art-{s.side}-older"
						onclick={() => {
							const k = stepMonth(months, s.key, 1);
							if (isThen) thenKey = k;
							else nowKey = k;
						}}>◀</button
					>
					<span class="text-body font-extrabold" data-testid="art-{s.side}-label">
						{months.find((m) => m.key === s.key)?.label}
					</span>
					<button
						type="button"
						class="{btn} border-line bg-surface"
						aria-label="{s.side}: later month"
						data-testid="art-{s.side}-newer"
						onclick={() => {
							const k = stepMonth(months, s.key, -1);
							if (isThen) thenKey = k;
							else nowKey = k;
						}}>▶</button
					>
				</div>
				{#if s.shot}
					<img
						src={s.shot.src}
						alt="{who.name}'s drawing, {s.side.toLowerCase()}"
						class="h-64 rounded-chip bg-draw-paper"
						data-testid="art-shot"
					/>
				{/if}
			</div>
		{/each}
	</div>
{:else}
	<div class="flex w-full items-center gap-3">
		<MemberAvatar name={who.name} color={memberColor(who.color)} avatar={who.avatar} size="kid" />
		<p class="text-body font-extrabold" data-testid="art-title">{who.name}'s art book</p>
		{#if pair}
			<button
				type="button"
				class="{btn} border-line bg-surface px-3"
				data-testid="art-compare-open"
				onclick={() => (comparing = true)}>Then and now</button
			>
		{/if}
	</div>
	{#if entries === null}
		<p class="w-full text-body text-ink-muted">Loading...</p>
	{:else if months.length === 0}
		<p class="w-full text-body text-ink-muted" data-testid="art-empty">
			No drawings in this book yet. Post one and it shows up here!
		</p>
	{/if}
	{#each months as m (m.key)}
		<section class="w-full" data-testid="art-month" aria-label={m.label}>
			<p class="text-body font-extrabold text-ink-muted">{m.label}</p>
			<ul class="flex flex-wrap gap-3">
				{#each m.entries as d (d.id)}
					<li class="flex flex-col items-center gap-2" data-testid="art-item">
						<img
							src={d.src}
							alt="{who.name}'s drawing from {m.label}"
							class="h-24 rounded-chip bg-draw-paper"
							data-testid="art-drawing"
						/>
						{#if adult}
							<button
								type="button"
								class="{btn} border-line bg-surface px-3"
								aria-label="Remove this drawing from the book"
								data-testid="art-remove"
								onclick={() => void removeDrawing(d)}>Remove</button
							>
						{/if}
					</li>
				{/each}
			</ul>
		</section>
	{/each}
{/if}
<Button variant="ghost" size="kid" onclick={back} data-testid="art-back">Back</Button>
