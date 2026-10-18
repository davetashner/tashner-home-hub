<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { deliver } from '#lib/offline/client.js';
	import TodoRow from '#lib/components/kid/TodoRow.svelte';
	import RoutinePlayer from '#lib/components/kid/RoutinePlayer.svelte';
	import MemberAvatar from '#lib/components/MemberAvatar.svelte';
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
	import {
		localDate,
		setStatus,
		UNDO_WINDOW_MS,
		type KidChore,
		type KidGroup
	} from '#lib/domain/kid-chores.js';
	import type { MemberColor } from '#lib/domain/member-colors.js';
	import { resolveTimeZone, runtimeZone } from '#lib/domain/time-zone.js';

	/**
	 * The wall's home while a sitter session runs (hub-7pj.2): tonight's plan on the left, each
	 * child's To-Dos for tonight, the house rules and the check-in buttons on the right.
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
	let boards = $state<Record<string, KidGroup[]>>({});
	let routines = $state<(KidRoutine & { memberId: string })[]>([]);
	let dinner = $state<string | null>(null);
	let playing = $state<string | null>(null);
	let undoStarts = $state<Record<string, number>>({});
	let sent = $state<string | null>(null);
	let sentTimer: ReturnType<typeof setTimeout> | undefined;

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
	const feedings = $derived(
		(sitter.card?.pets ?? sitter.tonight?.pets ?? []).flatMap((p) =>
			p.feedTimes.map((time) => ({ name: p.name, time }))
		)
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
					feedings,
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
			const [rows, meals, ...results] = await Promise.all([
				api<(KidRoutine & { memberId: string })[]>(`/api/routines?date=${date}`).catch(() => null),
				api<{ meal: string; title: string }[]>(`/api/meals?from=${date}&to=${date}`).catch(
					() => null
				),
				...list
					.filter((m) => m.role !== 'adult')
					.map((m) =>
						api<KidGroup[]>(`/api/members/${m.id}/chores?date=${date}&tz=${encodeURIComponent(tz)}`)
							.then((groups) => [m.id, groups] as const)
							.catch(() => null)
					)
			]);
			if (rows) routines = rows;
			if (meals) dinner = meals.find((e) => e.meal === 'dinner')?.title ?? null;
			for (const r of results) if (r) boards[r[0]] = r[1];
		} catch {
			// Offline blip: keep what is on the wall; the next refresh tries again.
		}
	}

	onMount(() => {
		void refresh();
		const timer = setInterval(() => void refresh(), 60_000);
		return () => {
			clearInterval(timer);
			clearTimeout(sentTimer);
			clearTimeout(failedTimer);
		};
	});

	/** To-Dos for tonight: the evening group and the "anytime" ones. */
	const tonightOf = (id: string): KidChore[] =>
		(boards[id] ?? [])
			.filter((g) => g.timeOfDay === 'evening' || g.timeOfDay === 'anytime')
			.flatMap((g) => g.chores);

	const tapKey = (memberId: string, choreId: string) => `${memberId}:${choreId}`;

	function done(memberId: string, chore: KidChore) {
		const optimistic = chore.requiresApproval === false ? 'approved' : 'pending';
		boards[memberId] = setStatus(boards[memberId] ?? [], chore.id, optimistic, null);
		undoStarts[tapKey(memberId, chore.id)] = Date.now();
		void deliver<{ completion: { id: string | null; status: KidChore['status'] } }>({
			kind: 'complete',
			url: `/api/chores/${chore.id}/complete`,
			body: { memberId, date: localDate(Date.now(), tz) },
			choreId: chore.id
		})
			.then((r) => {
				if (r.sent)
					boards[memberId] = setStatus(
						boards[memberId] ?? [],
						chore.id,
						r.data.completion.status,
						r.data.completion.id
					);
				else if (!r.queued) throw new Error(String(r.status));
			})
			.catch(() => {
				boards[memberId] = setStatus(boards[memberId] ?? [], chore.id, 'none', null);
			});
	}

	function undo(memberId: string, chore: KidChore) {
		const startedAt = undoStarts[tapKey(memberId, chore.id)] ?? Date.now();
		boards[memberId] = setStatus(boards[memberId] ?? [], chore.id, 'none', null);
		if (!chore.completionId) return;
		void deliver({
			kind: 'undo',
			url: `/api/completions/${chore.completionId}/undo`,
			body: {},
			choreId: chore.id,
			expiresAt: startedAt + UNDO_WINDOW_MS
		}).catch(() => {});
	}

	function dropUndo(key: string) {
		undoStarts = Object.fromEntries(Object.entries(undoStarts).filter(([k]) => k !== key));
	}

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

	const CHECKINS = [
		{ kind: 'in-bed', label: 'Kids in bed' },
		{ kind: 'all-good', label: 'All good' },
		{ kind: 'call-me', label: 'Call me' }
	] as const;

	let failed = $state<string | null>(null);
	let failedTimer: ReturnType<typeof setTimeout> | undefined;

	/** Optimistic: shows "Sent" at once and rolls back with a message if the hub says no. */
	async function checkin(c: (typeof CHECKINS)[number]) {
		clearTimeout(sentTimer);
		clearTimeout(failedTimer);
		failed = null;
		sent = c.kind;
		sentTimer = setTimeout(() => (sent = null), 5000);
		let ok = false;
		try {
			const res = await fetch('/api/sitter/checkin', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ kind: c.kind })
			});
			ok = res.ok;
		} catch {
			// Offline: treated like a refusal below.
		}
		if (ok) return;
		if (sent === c.kind) sent = null;
		failed = 'That did not send. Try again, or call the grown-ups.';
		failedTimer = setTimeout(() => (failed = null), 6000);
	}

	const ICON: Record<PlanItem['kind'], string> = {
		dinner: '🍽️',
		routine: '🛁',
		bedtime: '🌙',
		pet: '🐾',
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
			{#each kids as kid (kid.id)}
				{@const chores = tonightOf(kid.id)}
				<section
					aria-label="{kid.name}'s To-Dos tonight"
					data-testid="sitter-kid"
					class="flex flex-col gap-2 rounded-card bg-surface-sunken p-4 short:p-2"
				>
					<h2 class="flex items-center gap-3 text-lead font-extrabold">
						<MemberAvatar name={kid.name} color={kid.color} avatar={kid.avatar} size="md" />
						{kid.name}
					</h2>
					{#each chores as chore (chore.id)}
						{@const key = tapKey(kid.id, chore.id)}
						<TodoRow
							{chore}
							undoStartedAt={undoStarts[key] ?? null}
							ondone={() => done(kid.id, chore)}
							onundo={() => undo(kid.id, chore)}
							onundoexpire={() => dropUndo(key)}
						/>
					{:else}
						<p class="text-body text-ink-muted">Nothing left tonight.</p>
					{/each}
				</section>
			{/each}

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

			<section aria-label="Check in" class="flex flex-col gap-2">
				<div class="flex flex-wrap gap-3">
					{#each CHECKINS as c (c.kind)}
						<button
							type="button"
							onclick={() => checkin(c)}
							data-testid="checkin-{c.kind}"
							class="min-h-tap-kid grow rounded-card bg-surface-raised px-6 text-body font-extrabold shadow-raised active:scale-95"
						>
							{sent === c.kind ? 'Sent ✓' : c.label}
						</button>
					{/each}
				</div>
				{#if failed}
					<p role="alert" class="text-body font-bold text-danger" data-testid="checkin-failed">
						{failed}
					</p>
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
