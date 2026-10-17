<script lang="ts">
	import { onMount } from 'svelte';
	import MemberAvatar from '#lib/components/MemberAvatar.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import type { MemberColor } from '#lib/domain/member-colors.js';
	import type { WeeklySummary } from '#lib/server/domain/weekly-summary.js';

	/** Missed chores shown before the list collapses behind a "show all" tap. */
	const SHOWN = 3;

	let summary = $state<WeeklySummary | null>(null);
	let failed = $state(false);
	let expanded = $state<Record<string, boolean>>({});

	async function load(week?: string) {
		failed = false;
		const res = await fetch(`/api/summary/weekly${week ? `?week=${week}` : ''}`).catch(() => null);
		if (res?.ok) {
			summary = (await res.json()) as WeeklySummary;
			expanded = {};
		} else failed = true;
	}
	onMount(() => void load());

	const fmt = (date: string, opts: Intl.DateTimeFormatOptions) =>
		new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { timeZone: 'UTC', ...opts });
	const range = (s: WeeklySummary) =>
		`${fmt(s.start, { month: 'short', day: 'numeric' })} – ${fmt(s.end, { month: 'short', day: 'numeric' })}`;
	const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');
</script>

<svelte:head><title>Weekly summary · Home Hub</title></svelte:head>

<section class="mx-auto flex w-full max-w-4xl flex-col gap-6 p-8 max-sm:p-3">
	<h1 class="text-headline font-extrabold">Weekly summary</h1>

	{#if failed}
		<p class="text-lead text-danger" role="alert">Couldn't load the summary. Please try again.</p>
	{/if}

	{#if summary}
		<div class="flex items-center justify-between gap-2">
			<Button
				variant="secondary"
				aria-label="Previous week"
				data-testid="prev-week"
				onclick={() => summary && load(summary.prev)}>‹</Button
			>
			<p class="min-w-0 text-center text-lead font-bold" data-testid="week-range">
				{range(summary)}
				{#if summary.partial}
					<span class="block text-caption font-normal text-ink-muted">This week so far</span>
				{/if}
			</p>
			<Button
				variant="secondary"
				aria-label="Next week"
				data-testid="next-week"
				disabled={summary.next === null}
				class="disabled:opacity-40"
				onclick={() => summary?.next && load(summary.next)}>›</Button
			>
		</div>

		{#if summary.children.length === 0}
			<p class="text-lead text-ink-muted" data-testid="summary-empty">
				No children yet. Add them under Family.
			</p>
		{:else}
			<p class="text-body text-ink-muted" data-testid="family-totals">
				Family: {signed(summary.family.net)} ⭐ · {summary.family.done} of {summary.family.due} Star Jobs
				done · {summary.family.missed} missed
			</p>
		{/if}

		<ul class="flex flex-col gap-4">
			{#each summary.children as c (c.memberId)}
				{@const list = expanded[c.memberId] ? c.missed : c.missed.slice(0, SHOWN)}
				<li data-testid="summary-card" data-member={c.memberId}>
					<Card class="flex flex-col gap-4 !p-6 max-sm:!p-4">
						<div class="flex items-center gap-4">
							<MemberAvatar name={c.name} color={c.color as MemberColor} avatar={c.avatar} />
							<span class="min-w-0 flex-1 truncate text-title font-bold">{c.name}</span>
							<span class="text-title font-extrabold" data-testid="net">{signed(c.net)} ⭐</span>
						</div>
						<p class="text-body text-ink-muted" data-testid="stars-line">
							Earned {c.earned} · Spent {c.spent} · Removed {c.removed} · Balance {c.balance}
						</p>
						<div class="flex flex-col gap-2">
							<p class="text-body font-bold" data-testid="done-line">
								{c.done} of {c.due} Star Jobs done{c.pending > 0 ? ` · ${c.pending} waiting` : ''}
							</p>
							<div
								class="h-4 overflow-hidden rounded-chip bg-surface-sunken"
								role="progressbar"
								aria-label="Star Jobs done"
								aria-valuemin={0}
								aria-valuemax={c.due}
								aria-valuenow={c.done}
							>
								<div
									class="h-full rounded-chip bg-success"
									style:width="{c.due > 0 ? (c.done / c.due) * 100 : 0}%"
								></div>
							</div>
						</div>
						<p class="text-body text-ink-muted">
							Streak {c.streak} day{c.streak === 1 ? '' : 's'}{c.bestDay
								? ` · Best day ${fmt(c.bestDay.date, { weekday: 'short' })} (${c.bestDay.stars} ⭐)`
								: ''}
						</p>
						{#if c.missed.length > 0}
							<div class="flex flex-col gap-2">
								<h2 class="text-body font-bold text-danger">Missed ({c.missed.length})</h2>
								<ul class="flex flex-col gap-1" data-testid="missed-list">
									{#each list as m (m.date + m.choreId)}
										<li class="flex justify-between gap-4 text-body">
											<span class="min-w-0 truncate">{m.title}</span>
											<span class="shrink-0 text-ink-muted">
												{fmt(m.date, { weekday: 'short', day: 'numeric' })}
											</span>
										</li>
									{/each}
								</ul>
								{#if c.missed.length > SHOWN}
									<Button
										variant="ghost"
										data-testid="toggle-missed"
										aria-expanded={!!expanded[c.memberId]}
										onclick={() => (expanded[c.memberId] = !expanded[c.memberId])}
									>
										{expanded[c.memberId] ? 'Show fewer' : `Show all ${c.missed.length}`}
									</Button>
								{/if}
							</div>
						{:else if c.due > 0}
							<p class="text-body text-success">Nothing missed 🎉</p>
						{/if}
					</Card>
				</li>
			{/each}
		</ul>
	{/if}
</section>
