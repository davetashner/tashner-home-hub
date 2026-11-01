<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { createLiveChannel } from '#lib/domain/live-events.js';
	import { DEFAULT_TEAMS, type Game, type SportsTeam } from '#lib/domain/sports.js';
	import { stripCards, type StripCard } from '#lib/domain/sports-strip.js';
	import { discClass, edgeClass } from '#lib/domain/team-colors.js';
	// The sheet loads in its own chunk (the home page's bundle budget is full); onMount prefetches
	// it so a tap still opens it at once.
	const loadSheet = () => import('#lib/components/home/SportsSheet.svelte');
	import { isTimeZone, runtimeZone } from '#lib/domain/time-zone.js';

	/** Tells the home page when the strip takes room, so it can tighten its spacing. */
	let { onshown }: { onshown?: (shown: boolean) => void } = $props();

	let games = $state<Game[]>([]);
	let teams = $state<SportsTeam[]>([...DEFAULT_TEAMS]);
	let now = $state(Date.now());

	const zone = $derived(isTimeZone(page.data.timeZone) ? page.data.timeZone : runtimeZone());
	const cards = $derived(stripCards(games, teams, now, zone));
	$effect(() => {
		onshown?.(cards.length > 0);
	});

	async function load() {
		try {
			const res = await fetch('/api/sports');
			if (res.ok) {
				const body = (await res.json()) as { teams?: SportsTeam[]; games?: Game[] };
				if (Array.isArray(body.teams)) teams = body.teams;
				if (Array.isArray(body.games)) games = body.games;
			}
		} catch {
			// offline: keep whatever is already showing
		}
		now = Date.now();
	}

	onMount(() => {
		void load();
		void loadSheet().catch(() => undefined);
		const channel = createLiveChannel({
			url: '/api/events',
			topics: ['sports'],
			create: (url) => new EventSource(url),
			onEvent: () => void load(),
			onOpen: () => void load()
		});
		channel.start();
		// Countdowns, "Today" and the 6 AM final cut-off follow the local clock; the poll is the SSE fallback.
		const tick = setInterval(() => (now = Date.now()), 30_000);
		const poll = setInterval(() => void load(), 5 * 60_000);
		return () => {
			channel.stop();
			clearInterval(tick);
			clearInterval(poll);
		};
	});

	const discOf = (c: StripCard) => discClass(c.teamId);
	const edgeOf = (c: StripCard) => edgeClass(c.teamId);
	let sheetOpen = $state(false);
</script>

{#if cards.length > 0}
	<section
		aria-label="Sports"
		data-testid="sports-strip"
		class="flex gap-4 portrait:flex-col short:gap-2"
	>
		{#each cards as c (c.key)}
			<button
				type="button"
				aria-haspopup="dialog"
				onclick={() => (sheetOpen = true)}
				data-testid="sports-card"
				data-team={c.teamId}
				data-state={c.state}
				class="flex min-h-tap min-w-0 items-center gap-4 rounded-card border-2 bg-surface-raised px-5 py-3 text-left shadow-raised transition-transform duration-75 active:scale-95 short:gap-2 short:px-3 short:py-2 {c.big
					? `flex-2 py-4 ${edgeOf(c)} portrait:flex-none`
					: 'flex-1 border-line portrait:flex-none'}"
			>
				<span
					aria-hidden="true"
					class="grid flex-none place-items-center rounded-full font-black {discOf(c)} {c.big
						? 'size-20 text-body short:size-14 short:text-caption'
						: 'size-16 text-caption short:size-12'}">{c.abbr}</span
				>
				<span class="flex min-w-0 flex-1 flex-col">
					{#if c.eyebrow}
						<span
							data-testid="sports-eyebrow"
							class="flex items-center gap-2 text-caption font-black tracking-wide uppercase {c.state ===
							'live'
								? 'text-danger'
								: ''}"
						>
							{#if c.state === 'live'}
								<span aria-hidden="true" class="live-dot size-3 flex-none rounded-full bg-danger"
								></span>
							{/if}
							{c.eyebrow}
						</span>
					{/if}
					<span
						data-testid="sports-title"
						class="truncate font-black text-ink {c.big
							? 'text-lead'
							: 'text-body'} short:text-caption">{c.title}</span
					>
					{#if c.sub}
						<span class="truncate text-caption font-bold text-ink-muted">{c.sub}</span>
					{/if}
				</span>
				{#if c.countdown}
					<span class="flex-none text-right text-ink" data-testid="sports-countdown">
						<span class="block text-title leading-none font-black tabular-nums short:text-lead">
							{c.countdown.value}
						</span>
						<span
							class="mt-1 block text-caption font-extrabold tracking-wide text-ink-muted uppercase"
						>
							{c.countdown.unit}
						</span>
					</span>
				{:else if c.score}
					<span
						class="flex flex-none items-center gap-3 text-title leading-none font-black text-ink tabular-nums short:text-lead"
						data-testid="sports-score"
						aria-label="{c.score.team} to {c.score.opponent}"
					>
						<span>{c.score.team}</span><span aria-hidden="true" class="text-ink-muted">–</span><span
							>{c.score.opponent}</span
						>
					</span>
				{:else if c.result}
					<span
						data-testid="sports-result"
						class="flex-none rounded-chip px-4 py-1 text-body font-black text-on-accent {c.result ===
						'W'
							? 'bg-success'
							: 'bg-ink-muted'}">{c.result}</span
					>
				{/if}
				<span class="sr-only">Show games for the next two weeks</span>
			</button>
		{/each}
	</section>
{/if}
{#if sheetOpen}
	{#await loadSheet() then { default: SportsSheet }}
		<SportsSheet {games} {teams} {now} {zone} onclose={() => (sheetOpen = false)} />
	{/await}
{/if}
