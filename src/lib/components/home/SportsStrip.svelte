<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { createLiveChannel } from '#lib/domain/live-events.js';
	import { DEFAULT_TEAMS, type Game, type SportsTeam } from '#lib/domain/sports.js';
	import { stripCards, type StripCard } from '#lib/domain/sports-strip.js';
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

	// Full class names so Tailwind can see them. Colours are keyed by team id: the two WSH teams differ.
	const disc: Record<string, string> = {
		'nfl:bal': 'bg-team-bal text-team-bal-accent',
		'nfl:wsh': 'bg-team-was text-team-was-accent',
		'nhl:wsh': 'bg-team-wsh text-team-wsh-accent ring-4 ring-team-wsh-ring ring-inset'
	};
	const edge: Record<string, string> = {
		'nfl:bal': 'border-team-bal text-team-bal',
		'nfl:wsh': 'border-team-was text-team-was',
		'nhl:wsh': 'border-team-wsh text-team-wsh'
	};
	const discOf = (c: StripCard) => disc[c.teamId] ?? 'bg-accent text-on-accent';
	const edgeOf = (c: StripCard) => edge[c.teamId] ?? 'border-accent text-accent';
</script>

{#if cards.length > 0}
	<section
		aria-label="Sports"
		data-testid="sports-strip"
		class="flex gap-4 portrait:flex-col short:gap-2"
	>
		{#each cards as c (c.key)}
			<div
				data-testid="sports-card"
				data-team={c.teamId}
				data-state={c.state}
				class="flex min-h-tap min-w-0 items-center gap-4 rounded-card border-2 bg-surface-raised px-5 py-3 shadow-raised short:gap-2 short:px-3 short:py-2 {c.big
					? `flex-2 py-4 ${edgeOf(c)} portrait:flex-none`
					: 'flex-1 border-line portrait:flex-none'}"
			>
				<span
					aria-hidden="true"
					class="grid flex-none place-items-center rounded-full font-black {discOf(c)} {c.big
						? 'size-20 text-body short:size-14 short:text-caption'
						: 'size-16 text-caption short:size-12'}">{c.abbr}</span
				>
				<div class="flex min-w-0 flex-1 flex-col">
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
				</div>
				{#if c.countdown}
					<div class="flex-none text-right text-ink" data-testid="sports-countdown">
						<div class="text-title leading-none font-black tabular-nums short:text-lead">
							{c.countdown.value}
						</div>
						<div class="mt-1 text-caption font-extrabold tracking-wide text-ink-muted uppercase">
							{c.countdown.unit}
						</div>
					</div>
				{:else if c.score}
					<div
						class="flex flex-none items-center gap-3 text-title leading-none font-black text-ink tabular-nums short:text-lead"
						data-testid="sports-score"
						aria-label="{c.score.team} to {c.score.opponent}"
					>
						<span>{c.score.team}</span><span aria-hidden="true" class="text-ink-muted">–</span><span
							>{c.score.opponent}</span
						>
					</div>
				{:else if c.result}
					<span
						data-testid="sports-result"
						class="flex-none rounded-chip px-4 py-1 text-body font-black text-on-accent {c.result ===
						'W'
							? 'bg-success'
							: 'bg-ink-muted'}">{c.result}</span
					>
				{/if}
			</div>
		{/each}
	</section>
{/if}
