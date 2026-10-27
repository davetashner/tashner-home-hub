<script lang="ts">
	import Button from '#lib/components/ui/Button.svelte';
	import { shiftWeeks, weekLine, type PracticeWeek } from '#lib/domain/practice-week.js';

	interface WeekView extends PracticeWeek {
		today: string;
		activityInfo: { activityId: string; name: string; emoji: string | null }[];
	}

	/**
	 * "My week" (hub-kko.3): minutes per day, Monday to Sunday, stacked by activity, with the week's
	 * total and stars. Lives inside the log sheet so the kid screen gains no row. Reloads whenever
	 * `version` changes (after a log or an undo).
	 */
	let { memberId, version }: { memberId: string; version: number } = $props();

	const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
	const COLOURS = ['bg-habit', 'bg-job', 'bg-success', 'bg-accent'];
	// A bar never looks full for a few minutes: the scale is at least an hour.
	const MIN_SCALE = 60;

	let week = $state<WeekView | null>(null);
	let failed = $state(false);
	// null = this week; otherwise the Monday of the week being looked at.
	let anchor = $state<string | null>(null);

	const scale = $derived(Math.max(MIN_SCALE, ...(week?.days ?? []).map((d) => d.minutes)));
	const colourOf = (id: string) =>
		COLOURS[(week?.activityInfo ?? []).findIndex((a) => a.activityId === id) % COLOURS.length];
	const isCurrent = $derived(week?.days.some((d) => d.isToday) ?? true);

	$effect(() => {
		void version;
		void load(anchor ?? 'current');
	});

	async function load(which: string) {
		try {
			const res = await fetch(`/api/members/${memberId}/practice-logs?week=${which}`);
			if (!res.ok) throw new Error(String(res.status));
			const body = (await res.json()) as WeekView;
			if ((anchor ?? 'current') === which) week = body;
			failed = false;
		} catch {
			failed = week === null;
		}
	}

	function go(by: -1 | 1) {
		if (!week) return;
		const next = shiftWeeks(week.weekStart, by);
		anchor = by === 1 && next > week.today ? null : next;
	}
</script>

<section aria-label="My week" data-testid="practice-week" class="flex flex-col gap-3">
	<div class="flex items-center justify-between gap-3">
		<Button
			variant="secondary"
			size="kid"
			aria-label="Last week"
			data-testid="practice-week-prev"
			onclick={() => go(-1)}>&lt;</Button
		>
		<p class="text-center text-lead leading-tight font-extrabold" data-testid="practice-week-total">
			{#if week}
				{weekLine(week.totalMinutes, week.stars)}
			{:else if failed}
				We cannot reach the hub right now.
			{:else}
				&nbsp;
			{/if}
		</p>
		<Button
			variant="secondary"
			size="kid"
			aria-label="Next week"
			data-testid="practice-week-next"
			disabled={isCurrent}
			onclick={() => go(1)}>&gt;</Button
		>
	</div>

	{#if week}
		<div class="grid grid-cols-7 gap-2 short:gap-1" data-testid="practice-week-chart">
			{#each week.days as d, i (d.date)}
				<div
					class="flex flex-col items-center gap-1"
					data-testid="practice-week-day"
					data-today={d.isToday}
					data-minutes={d.minutes}
				>
					<p class="text-lead leading-none font-extrabold">{d.minutes}</p>
					<div
						class="flex h-40 w-full items-end overflow-hidden rounded-card bg-surface-sunken short:h-20"
					>
						<div
							class="bar flex w-full origin-bottom flex-col-reverse {d.isToday
								? 'border-4 border-ink'
								: ''}"
							style:height="100%"
							style:transform="scaleY({d.minutes / scale})"
						>
							{#each Object.entries(d.byActivity) as [id, m] (id)}
								<div class={colourOf(id)} style:flex-grow={m} style:flex-basis="0"></div>
							{/each}
						</div>
					</div>
					<p
						class="w-full rounded-card px-1 text-center text-body leading-tight font-extrabold {d.isToday
							? 'bg-ink text-on-accent'
							: ''}"
					>
						{DAYS[i]}
					</p>
				</div>
			{/each}
		</div>
		<ul class="flex flex-wrap justify-center gap-x-6 gap-y-1" data-testid="practice-week-legend">
			{#each week.activityInfo as a (a.activityId)}
				<li class="flex items-center gap-2 text-body font-extrabold">
					<span class="size-4 rounded-card {colourOf(a.activityId)}" aria-hidden="true"></span>
					<span aria-hidden="true">{a.emoji ?? '📚'}</span>
					{a.name}
					{week.activities.find((x) => x.activityId === a.activityId)?.minutes}
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.bar {
		animation: bar-grow var(--duration-base) var(--ease-out-soft) both;
	}
	@keyframes bar-grow {
		from {
			transform: scaleY(0);
		}
	}
</style>
