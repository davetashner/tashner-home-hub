<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { deliver } from '#lib/offline/client.js';
	import RoutinePlayer from '#lib/components/kid/RoutinePlayer.svelte';
	import { sitter } from '#lib/components/shell/sitter-state.svelte.js';
	import { backAroundLabel } from '#lib/domain/sitter.js';
	import {
		buildPlan,
		countdownLabel,
		parentsLabel,
		parentsVerb,
		type PlanItem
	} from '#lib/domain/sitter-plan.js';
	import { advance, minutesInZone, type KidRoutine } from '#lib/domain/routines.js';
	import { localDate } from '#lib/domain/kid-chores.js';
	import type { MemberColor } from '#lib/domain/member-colors.js';
	import { resolveTimeZone, runtimeZone } from '#lib/domain/time-zone.js';

	/**
	 * The wall's home while a sitter session runs (hub-7pj.2): tonight's plan and the house rules.
	 */
	interface Member {
		id: string;
		name: string;
		role: string;
		color: MemberColor;
		avatar: string | null;
	}

	const tz = $derived(resolveTimeZone(page.data.timeZone, runtimeZone()));
	let members = $state<Member[]>([]);
	let routines = $state<(KidRoutine & { memberId: string })[]>([]);
	let dinner = $state<string | null>(null);
	let playing = $state<string | null>(null);

	const kids = $derived(members.filter((m) => m.role !== 'adult'));
	const adults = $derived(members.filter((m) => m.role === 'adult').map((m) => m.name));
	const session = $derived(sitter.session);
	const nowMinutes = $derived(minutesInZone(sitter.now, tz));
	const rules = $derived(sitter.card?.rules ?? sitter.tonight?.rules ?? []);
	const bedtimes = $derived(
		(sitter.card
			? sitter.card.kids.map((k) => ({ memberId: k.memberId, bedtime: k.bedtime }))
			: (sitter.tonight?.bedtimes ?? [])
		).flatMap((b) => {
			const kid = kids.find((k) => k.id === b.memberId);
			return kid ? [{ name: kid.name, bedtime: b.bedtime }] : [];
		})
	);
	const plan = $derived(
		session
			? buildPlan({
					nowMinutes,
					nowMs: sitter.now,
					endAt: session.endAt,
					endMinutes: minutesInZone(session.endAt, tz),
					endsLater: localDate(session.endAt, tz) !== localDate(sitter.now, tz),
					dinner,
					routines: routines.flatMap((r) => {
						const kid = kids.find((k) => k.id === r.memberId);
						return kid ? [{ ...r, kidName: kid.name }] : [];
					}),
					bedtimes,
					parents: parentsLabel(adults)
				})
			: []
	);
	const player = $derived(routines.find((r) => r.id === playing) ?? null);

	async function api<T>(url: string): Promise<T> {
		const res = await fetch(url);
		if (!res.ok) throw new Error(String(res.status));
		return (await res.json()) as T;
	}

	async function refresh() {
		const date = localDate(Date.now(), tz);
		try {
			const list = await api<Member[]>('/api/members');
			members = list;
			const [rows, meals] = await Promise.all([
				api<(KidRoutine & { memberId: string })[]>(`/api/routines?date=${date}`).catch(() => null),
				api<{ meal: string; title: string }[]>(`/api/meals?from=${date}&to=${date}`).catch(
					() => null
				)
			]);
			if (rows) routines = rows;
			if (meals) dinner = meals.find((e) => e.meal === 'dinner')?.title ?? null;
		} catch {
			// Offline blip: keep what is on the wall; the next refresh tries again.
		}
	}

	onMount(() => {
		void refresh();
		const timer = setInterval(() => void refresh(), 60_000);
		return () => clearInterval(timer);
	});

	function routineDone(routine: KidRoutine, index: number) {
		const next = advance(routine.done, index, routine.steps.length);
		routines = routines.map((r) => (r.id === routine.id ? { ...r, done: next } : r));
		void deliver({
			kind: 'routine-step',
			url: `/api/routines/${routine.id}/progress`,
			body: { date: localDate(Date.now(), tz), step: index },
			routineId: routine.id
		}).catch(() => {});
	}

	const ICON: Record<PlanItem['kind'], string> = {
		dinner: '🍽️',
		routine: '🛁',
		bedtime: '🌙',
		home: '🏠'
	};
</script>

<div
	data-testid="sitter-home"
	class="flex min-h-full flex-col gap-6 p-8 portrait:p-6 short:gap-3 short:p-3 tablet:gap-4 tablet:p-4"
>
	<header>
		<h1
			class="text-headline leading-tight font-extrabold short:text-title"
			data-testid="sitter-title"
		>
			{session?.sitterName ? `Tonight with ${session.sitterName}` : 'Tonight'}
		</h1>
		{#if session}
			<p class="text-lead text-ink-muted" data-testid="sitter-back">
				{parentsLabel(adults)}
				{parentsVerb(adults)} back around {backAroundLabel(session.endAt, sitter.now, tz)}
			</p>
		{/if}
	</header>

	<div
		class="grid grid-cols-2 items-start gap-6 portrait:grid-cols-1 short:gap-3 tablet:grid-cols-1"
	>
		<section
			aria-labelledby="plan-h"
			class="flex flex-col gap-3 rounded-card bg-surface-raised p-6 shadow-raised short:p-3"
		>
			<h2 id="plan-h" class="text-lead font-extrabold">Tonight's plan</h2>
			<ol class="flex flex-col gap-3" data-testid="sitter-plan">
				{#each plan as item (item.key)}
					<li
						data-testid="plan-item"
						data-kind={item.kind}
						data-now={item.now ? '' : undefined}
						class="flex min-h-tap-kid flex-wrap items-center gap-3 rounded-card border-4 px-4 py-2 {item.now
							? 'border-accent bg-accent-soft'
							: 'border-line bg-surface'} {item.done ? 'opacity-70' : ''}"
					>
						<span class="text-title leading-none" aria-hidden="true">{ICON[item.kind]}</span>
						<div class="min-w-0 grow">
							<p class="text-body leading-tight font-extrabold break-words">{item.label}</p>
							<p class="text-caption text-ink-muted" data-testid="plan-when">
								{item.kind === 'dinner' ? 'Around 6' : countdownLabel(item.inMinutes)}
							</p>
						</div>
						{#if item.now}
							<span
								class="rounded-chip bg-accent px-3 py-1 text-caption font-extrabold text-on-accent"
								data-testid="plan-now">Now</span
							>
						{/if}
						{#if item.kind === 'routine' && item.routineId && !item.done}
							{@const id = item.routineId}
							<button
								type="button"
								onclick={() => (playing = id)}
								data-testid="plan-start"
								class="min-h-tap-kid rounded-chip bg-habit px-6 text-body font-extrabold text-on-accent active:scale-95"
							>
								Start
							</button>
						{/if}
					</li>
				{/each}
			</ol>
		</section>

		<div class="flex flex-col gap-6 short:gap-3">
			<section
				class="flex flex-col gap-2 rounded-card bg-surface-raised p-6 shadow-raised short:p-3"
			>
				<h2 class="text-lead font-extrabold">House rules</h2>
				{#if rules.length > 0}
					<ul class="list-disc pl-6 text-body" data-testid="sitter-rules">
						{#each rules as rule, i (i)}<li>{rule}</li>{/each}
					</ul>
				{:else}
					<p class="text-body text-ink-muted">No special rules tonight.</p>
				{/if}
			</section>
		</div>
	</div>
</div>

{#if player}
	{@const current = player}
	<RoutinePlayer
		routine={current}
		ondone={(i) => routineDone(current, i)}
		onclose={() => (playing = null)}
	/>
{/if}
