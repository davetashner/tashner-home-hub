<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { deliver, onWriteDropped, writeQueue } from '#lib/offline/client.js';
	import { offline } from '#lib/offline/state.svelte.js';
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import MemberAvatar from '#lib/components/MemberAvatar.svelte';
	import TodoRow from '#lib/components/kid/TodoRow.svelte';
	import StarJar, { type Goal } from '#lib/components/kid/StarJar.svelte';
	import PracticeLog from '#lib/components/kid/PracticeLog.svelte';
	import AllDoneBanner from '#lib/components/kid/AllDoneBanner.svelte';
	import EarnedBanner from '#lib/components/kid/EarnedBanner.svelte';
	import VacationCard from '#lib/components/kid/VacationCard.svelte';
	import { isVacationDay } from '#lib/domain/vacation.js';
	import StreakBadge from '#lib/components/kid/StreakBadge.svelte';
	import StreakBanner from '#lib/components/kid/StreakBanner.svelte';
	import StickerBanner from '#lib/components/kid/StickerBanner.svelte';
	import { badgeDecision, badgesSeenKey, earnedIds, type Sticker } from '#lib/domain/badges.js';
	import RoutineIcon from '#lib/components/kid/RoutineIcon.svelte';
	import RoutinePlayer from '#lib/components/kid/RoutinePlayer.svelte';
	import {
		activeRoutines,
		advance,
		isRoutineComplete,
		minutesInZone,
		type KidRoutine
	} from '#lib/domain/routines.js';
	import BonusBanner from '#lib/components/kid/BonusBanner.svelte';
	import { newBonuses, newestAt, type LedgerRow } from '#lib/domain/bonus.js';
	import { reachedMilestone, type Milestone } from '#lib/domain/streaks.js';
	import {
		celebrate,
		celebrateAllDone,
		celebrateApproval,
		celebrateGoal,
		preloadCelebrations
	} from '#lib/components/kid/celebrate.js';
	import { allDoneKey, approvedTransitions, isAllDone } from '#lib/domain/celebrate-logic.js';
	import { earnedDecision, earnedKey } from '#lib/domain/goal-jar.js';
	import EmptyState from '#lib/components/shell/EmptyState.svelte';
	import type { MemberColor } from '#lib/domain/member-colors.js';
	import {
		GROUP_HEADINGS,
		isDoable,
		localDate,
		setStatus,
		UNDO_WINDOW_MS,
		kidsToShow,
		defaultKid,
		starJobGroups,
		timeColumns,
		type TimeColumn,
		type ColumnKey,
		habitChores,
		doneCount,
		habitCount,
		type KidChore,
		type KidGroup
	} from '#lib/domain/kid-chores.js';
	import { childrenOf, planLoad, type MemberResult } from '#lib/domain/chore-load.js';
	import { overlayQueued, overlayRoutineSteps } from '#lib/domain/write-queue.js';
	import { resolveTimeZone, runtimeZone } from '#lib/domain/time-zone.js';
	import { TODO_FALLBACK } from '#lib/domain/nav.js';

	interface Member {
		id: string;
		name: string;
		color: MemberColor;
		avatar: string | null;
		role?: string;
	}
	type Completion = { id: string | null; status: KidChore['status'] };

	const tz = $derived(resolveTimeZone(page.data.timeZone, runtimeZone()));
	const todo = $derived(page.data.todoLabel ?? TODO_FALLBACK);

	let loaded = $state(false);
	// Children exist but we could not show any (server down, nothing saved yet).
	let unreachable = $state(false);
	// Some kids' chores could not be refreshed: we show what we have and keep trying.
	let partial = $state(false);
	let members = $state<Member[]>([]);
	let boards = $state<Record<string, KidGroup[]>>({});
	let selectedId = $state<string | null>(null);
	// Per child, so switching kids is instant and never mixes up their jars.
	let starsBy = $state<Record<string, { balance: number; pending: number }>>({});
	let goals = $state<Record<string, Goal | null>>({});
	let jar = $state<HTMLElement | null>(null);
	let message = $state<string | null>(null);
	let undoStarts = $state<Record<string, number>>({});
	let allDone = $state(false);
	let allDoneTimer: ReturnType<typeof setTimeout> | undefined;
	let allDoneUntil = 0;
	let earned = $state<Goal | null>(null);
	let streaks = $state<Record<string, { days: number; next: Milestone | null }>>({});
	let streakParty = $state<Milestone | null>(null);
	let streakTimer: ReturnType<typeof setTimeout> | undefined;
	let stickerParty = $state<Sticker | null>(null);
	let stickerTimer: ReturnType<typeof setTimeout> | undefined;
	const badgesMemo: Record<string, string | null> = {};
	let earnedTimer: ReturnType<typeof setTimeout> | undefined;
	let routinesBy = $state<Record<string, KidRoutine[]>>({});
	let playing = $state<string | null>(null);
	let nowMinutes = $state(minutesInZone(Date.now(), runtimeZone()));
	// Newest ledger row each child has already seen, so a grown-up's bonus is celebrated once.
	const seenAt: Record<string, number> = {};
	let bonusParty = $state<{ stars: number; note: string | null } | null>(null);
	let bonusTimer: ReturnType<typeof setTimeout> | undefined;
	// Fallback when localStorage is unavailable, so the party still happens only once per load.
	const earnedMemo: Record<string, string | null> = {};

	// Taps whose POST has not answered yet: memberId:choreId -> completion promise.
	const inflight: Record<string, Promise<Completion | null>> = {};
	const busy = () => Object.keys(inflight).length > 0;
	let messageTimer: ReturnType<typeof setTimeout> | undefined;

	// Games and Music hold back the kid shown here until their jobs are done (hub-ruz).
	$effect(() => {
		if (!selectedId) return;
		try {
			localStorage.setItem('hub.kid', selectedId);
		} catch {
			// Storage unavailable: the fun tabs fall back to the first held-back kid.
		}
	});

	const selected = $derived(members.find((m) => m.id === selectedId) ?? null);
	const groups = $derived(selectedId ? (boards[selectedId] ?? []) : []);
	const kids = $derived(kidsToShow(members));
	const stars = $derived((selectedId && starsBy[selectedId]) || { balance: 0, pending: 0 });
	const streak = $derived(selectedId ? (streaks[selectedId] ?? null) : null);
	/** Household vacation (hub-k0w): the board shows a paused card instead of the day's to-dos. */
	const onVacation = $derived(isVacationDay(page.data.vacation ?? null, localDate(Date.now(), tz)));
	const routines = $derived(selectedId ? (routinesBy[selectedId] ?? []) : []);
	const offered = $derived(activeRoutines(routines, nowMinutes));
	const player = $derived(routines.find((r) => r.id === playing) ?? null);
	const goal = $derived(selectedId ? (goals[selectedId] ?? null) : null);
	// Star Jobs and habits share one board; each section counts its own (hub-esf).
	const jobGroups = $derived(starJobGroups(groups));
	// Today's count; any-day to-dos ('week') are counted once done, not while still open.
	const jobs = $derived(
		doneCount(
			jobGroups.flatMap((g) =>
				g.timeOfDay === 'week' ? g.chores.filter((c) => !isDoable(c.status)) : g.chores
			)
		)
	);
	const habits = $derived(habitChores(groups));
	const habitsToday = $derived(habitCount(habits, routines));
	// Now first, so a narrow screen opens on what to do right now; wide screens restore the clock order.
	const columns = $derived(
		timeColumns(groups, offered, nowMinutes).sort((a, b) => Number(b.now) - Number(a.now))
	);
	const COLUMN_ORDER_CLASS: Record<ColumnKey, string> = {
		morning: 'landscape:order-1 short:order-none tablet:order-none',
		afternoon: 'landscape:order-2 short:order-none tablet:order-none',
		evening: 'landscape:order-3 short:order-none tablet:order-none'
	};
	// Week tally (Monday to today) and today's habit star, from the server.
	let habitWeeks = $state<Record<string, { done: number; due: number; starEarned: boolean }>>({});
	const habitWeek = $derived(selectedId ? (habitWeeks[selectedId] ?? null) : null);

	/** A chore can belong to several kids: undo and in-flight taps are tracked per child. */
	const tapKey = (memberId: string, choreId: string) => `${memberId}:${choreId}`;

	function starsOf(memberId: string) {
		if (!starsBy[memberId]) starsBy[memberId] = { balance: 0, pending: 0 };
		return starsBy[memberId];
	}

	async function api<T>(url: string): Promise<T> {
		const res = await fetch(url);
		if (!res.ok) throw new Error(String(res.status));
		return (await res.json()) as T;
	}

	function say(text: string) {
		message = text;
		clearTimeout(messageTimer);
		messageTimer = setTimeout(() => (message = null), 5000);
	}

	async function loadStars(id: string) {
		// Saved copies would undo the tap we are still holding for the server.
		if (offline.queued > 0) return;
		const [s, g] = await Promise.all([
			api<{ balance: number; pending: number; history: LedgerRow[] }>(
				`/api/members/${id}/stars?limit=10`
			),
			api<{ reward: Goal } | null>(`/api/members/${id}/goal`)
		]);
		starsBy[id] = { balance: s.balance, pending: s.pending };
		void loadStreak(id).catch(() => {});
		if (id === selectedId) void loadBadges(id).catch(() => {});
		// Only the child on screen: warming every jar must not cost a week of habit math per kid.
		if (id === selectedId) void loadHabits(id).catch(() => {});
		goals[id] = g && {
			id: g.reward.id,
			title: g.reward.title,
			image: g.reward.image,
			cost: g.reward.cost
		};
		const goalParty = id === selectedId && checkEarned(id);
		noticeBonus(id, s.history, goalParty);
	}

	/** A grown-up's bonus plays the star celebration; a deduction only changes the number. */
	function noticeBonus(id: string, history: LedgerRow[], goalParty: boolean) {
		const fresh = newBonuses(history, seenAt[id] ?? null);
		seenAt[id] = Math.max(seenAt[id] ?? 0, newestAt(history));
		// Reaching the goal already throws the bigger party.
		if (fresh.length === 0 || id !== selectedId || goalParty) return;
		const stars = fresh.reduce((sum, r) => sum + r.delta, 0);
		const note = fresh.length === 1 ? fresh[0].note : null;
		clearTimeout(bonusTimer);
		bonusTimer = setTimeout(
			async () => {
				bonusParty = { stars, note };
				await tick();
				celebrateApproval(jar, stars);
				bonusTimer = setTimeout(() => (bonusParty = null), 4500);
			},
			Math.max(0, allDoneUntil - Date.now()) + 300
		);
	}

	/** Habit tally; finishing the day's last habit plays a one-star party (hub-esf.4). */
	async function loadHabits(id: string) {
		const r = await api<{ week: { done: number; due: number }; starEarned: boolean }>(
			`/api/members/${id}/habits?date=${localDate(Date.now(), tz)}`
		);
		const before = habitWeeks[id];
		habitWeeks[id] = { ...r.week, starEarned: r.starEarned };
		if (before && !before.starEarned && r.starEarned && id === selectedId) {
			say('All your habits are done! You earned a star ⭐');
			await tick();
			celebrateApproval(jar, 1);
		}
	}

	/** Streak counter; a milestone party plays when the count grows onto one (CHO-10). */
	async function loadStreak(id: string) {
		const r = await api<{ days: number; next: Milestone | null; milestones: Milestone[] }>(
			`/api/members/${id}/streak?tz=${encodeURIComponent(tz)}`
		);
		const hit = reachedMilestone(streaks[id]?.days, r.days, r.milestones);
		streaks[id] = { days: r.days, next: r.next };
		if (!hit || id !== selectedId) return;
		clearTimeout(streakTimer);
		streakTimer = setTimeout(
			() => {
				streakParty = hit;
				celebrateGoal(jar);
				streakTimer = setTimeout(() => (streakParty = null), 4500);
			},
			Math.max(0, allDoneUntil - Date.now()) + 300
		);
	}

	/** New stickers (CHO-14) are derived on the server; this screen celebrates each one once. */
	async function loadBadges(id: string) {
		const book = await api<Sticker[]>(`/api/members/${id}/badges?tz=${encodeURIComponent(tz)}`);
		const key = badgesSeenKey(id);
		let stored = badgesMemo[key] ?? null;
		try {
			stored = localStorage.getItem(key);
		} catch {
			// no storage: use the in-memory memo
		}
		const decision = badgeDecision(stored, earnedIds(book));
		badgesMemo[key] = decision.store;
		try {
			localStorage.setItem(key, decision.store);
		} catch {
			// memo only
		}
		const fresh = book.find((s) => s.id === decision.celebrate[0]);
		if (!fresh || id !== selectedId) return;
		clearTimeout(stickerTimer);
		stickerTimer = setTimeout(
			() => {
				stickerParty = fresh;
				celebrateGoal(jar);
				stickerTimer = setTimeout(() => (stickerParty = null), 4500);
			},
			Math.max(0, allDoneUntil - Date.now()) + 300
		);
	}

	/** "You earned it!" once per reaching the goal (REW-3), after any all-done party. */
	function checkEarned(memberId: string): boolean {
		const key = earnedKey(memberId);
		let stored = earnedMemo[key] ?? null;
		try {
			stored = localStorage.getItem(key);
		} catch {
			// no storage: use the in-memory memo
		}
		const reward = goals[memberId] ?? null;
		const balance = starsBy[memberId]?.balance ?? 0;
		const decision = earnedDecision(
			stored,
			reward && { rewardId: reward.id, cost: reward.cost, balance }
		);
		earnedMemo[key] = decision.store;
		try {
			if (decision.store === null) localStorage.removeItem(key);
			else localStorage.setItem(key, decision.store);
		} catch {
			// memo only
		}
		if (!decision.celebrate || !reward) return false;
		clearTimeout(earnedTimer);
		earnedTimer = setTimeout(
			() => {
				earned = reward;
				celebrateGoal(jar);
				earnedTimer = setTimeout(() => (earned = null), 4500);
			},
			Math.max(0, allDoneUntil - Date.now()) + 300
		);
		return true;
	}

	/** Today's routines for everyone; keeps local progress if a tap has not reached the server yet. */
	type RoutineRow = KidRoutine & { memberId: string };
	function applyRoutines(all: RoutineRow[]) {
		const kept = Object.values(routinesBy).flat();
		const by: Record<string, KidRoutine[]> = {};
		for (const { memberId, ...r } of all) {
			const local = kept.find((k) => k.id === r.id);
			(by[memberId] ??= []).push({ ...r, done: Math.max(r.done, local?.done ?? 0) });
		}
		routinesBy = by;
		nowMinutes = minutesInZone(Date.now(), tz);
	}

	function routineDone(routine: KidRoutine, index: number) {
		const memberId = selectedId;
		if (!memberId) return;
		const done = advance(routine.done, index, routine.steps.length);
		routinesBy[memberId] = (routinesBy[memberId] ?? []).map((r) =>
			r.id === routine.id ? { ...r, done } : r
		);
		if (isRoutineComplete(done, routine.steps.length)) celebrateAllDone();
		// Through the write queue: a drop in the network or a reload keeps the step (the server
		// takes the highest step index, so a replay is harmless).
		void deliver({
			kind: 'routine-step',
			url: `/api/routines/${routine.id}/progress`,
			body: { date: localDate(Date.now(), tz), step: index },
			routineId: routine.id
		})
			// A finished routine can complete the day's habits: pick up the star.
			.then((r) => (r.sent ? loadStars(memberId) : undefined))
			.catch(() => {});
	}

	async function refresh() {
		if (busy()) return;
		try {
			const date = localDate(Date.now(), tz);
			// Started alongside the member and chore fetches; a failure must not blank the chores.
			const routinesFetch = api<RoutineRow[]>(`/api/routines?date=${date}`).catch(() => null);
			const list = await api<Member[]>('/api/members');
			const results = await Promise.all(
				childrenOf(list).map(async (m): Promise<MemberResult<KidGroup>> => {
					try {
						const groups = await api<KidGroup[]>(
							`/api/members/${m.id}/chores?date=${date}&tz=${encodeURIComponent(tz)}`
						);
						return { id: m.id, groups };
					} catch {
						return { id: m.id, failed: true };
					}
				})
			);
			const fetchedRoutines = await routinesFetch;
			if (busy()) return;
			const queued = await writeQueue.pending();
			const plan = planLoad(list, results, boards);
			const fresh = results.find((r) => r.id === selectedId);
			const approved =
				selectedId && fresh && 'groups' in fresh
					? approvedTransitions(boards[selectedId], fresh.groups)
					: { count: 0, stars: 0 };
			unreachable = plan.unreachable;
			partial = plan.failed.length > 0;
			members = plan.members;
			// Before choosing a child: a kid with only a routine counts too.
			if (fetchedRoutines) applyRoutines(fetchedRoutines);
			routinesBy = overlayRoutineSteps(routinesBy, queued);
			boards = Object.fromEntries(
				plan.members.map((m) => [m.id, overlayQueued(plan.boards[m.id], m.id, queued)] as const)
			);
			if (!plan.members.some((m) => m.id === selectedId)) {
				// ?member=<id> picks a child; the avatar switcher keeps it in sync.
				const want = page.url.searchParams.get('member');
				selectedId = defaultKid(plan.members, boards, routinesBy, nowMinutes, want)?.id ?? null;
			}
			if (selectedId) await loadStars(selectedId);
			// Warm the other kids' jars so switching to them shows real stars straight away.
			if (kids.length > 1)
				void Promise.allSettled(
					kids.filter((m) => m.id !== selectedId).map((m) => loadStars(m.id))
				);
			if (approved.count > 0) {
				await tick();
				celebrateApproval(jar, approved.stars);
			}
		} catch {
			if (!loaded) say('Hmm, I could not load your Star Jobs. Trying again soon!');
		} finally {
			loaded = true;
		}
	}

	// Queued taps just reached the server: pick up the real state.
	$effect(() => {
		if (offline.synced > 0) void refresh();
	});

	onMount(() => {
		onWriteDropped((write) => {
			if (write.kind !== 'routine-step') say('Hmm, that one is already with the grown-ups.');
			void refresh();
		});
		preloadCelebrations();
		void refresh();
		const onVisible = () => document.visibilityState === 'visible' && void refresh();
		document.addEventListener('visibilitychange', onVisible);
		const timer = setInterval(() => void refresh(), 60_000);
		return () => {
			document.removeEventListener('visibilitychange', onVisible);
			clearInterval(timer);
			clearTimeout(messageTimer);
			onWriteDropped(null);
			clearTimeout(allDoneTimer);
			clearTimeout(earnedTimer);
			clearTimeout(streakTimer);
			clearTimeout(stickerTimer);
			clearTimeout(bonusTimer);
		};
	});

	/** Switch child instantly: every board is already loaded, only the jar refreshes behind. */
	function choose(memberId: string) {
		if (memberId === selectedId) return;
		selectedId = memberId;
		// The last child's parties belong to them: do not play them on this child's screen.
		clearTimeout(allDoneTimer);
		clearTimeout(earnedTimer);
		clearTimeout(streakTimer);
		clearTimeout(stickerTimer);
		clearTimeout(bonusTimer);
		bonusParty = null;
		streakParty = null;
		stickerParty = null;
		allDone = false;
		earned = null;
		allDoneUntil = 0;
		void replaceState(
			resolve(`/(app)/chores?member=${encodeURIComponent(memberId)}`),
			page.state
		).catch(() => {});
		void loadStars(memberId).catch(() => {});
	}

	function patch(memberId: string, fn: (g: KidGroup[]) => KidGroup[]) {
		boards[memberId] = fn(boards[memberId] ?? []);
	}

	function dropUndo(key: string) {
		undoStarts = Object.fromEntries(Object.entries(undoStarts).filter(([k]) => k !== key));
	}

	/** Once per child per day: when the last chore is done, party (after the stars land). */
	function maybeAllDone(memberId: string) {
		if (!isAllDone(boards[memberId] ?? [])) return;
		const key = allDoneKey(memberId);
		const today = localDate(Date.now(), tz);
		try {
			if (localStorage.getItem(key) === today) return;
			localStorage.setItem(key, today);
		} catch {
			// no storage: party anyway
		}
		clearTimeout(allDoneTimer);
		allDoneUntil = Date.now() + 900 + 3000;
		allDoneTimer = setTimeout(() => {
			allDone = true;
			celebrateAllDone();
			allDoneTimer = setTimeout(() => (allDone = false), 3000);
		}, 900);
	}

	function done(chore: KidChore, card: HTMLElement) {
		const memberId = selectedId;
		if (!memberId) return;
		const key = tapKey(memberId, chore.id);
		const jarStars = starsOf(memberId);
		// Self-serve to-dos are gold at once; only ones a grown-up checks wait (hub-526).
		const optimistic = chore.requiresApproval === false ? 'approved' : 'pending';
		const bucket = optimistic === 'approved' ? 'balance' : 'pending';
		patch(memberId, (g) => setStatus(g, chore.id, optimistic, null));
		jarStars[bucket] += chore.stars;
		undoStarts[key] = Date.now();
		celebrate({
			choreId: chore.id,
			memberId,
			stars: chore.stars,
			origin: card,
			jar,
			gold: optimistic === 'approved'
		});
		maybeAllDone(memberId);
		const request = deliver<{ completion: Completion }>({
			kind: 'complete',
			url: `/api/chores/${chore.id}/complete`,
			body: { memberId, date: localDate(Date.now(), tz) },
			choreId: chore.id
		})
			.then((r): Completion | null => {
				if (r.sent) {
					patch(memberId, (g) =>
						setStatus(g, chore.id, r.data.completion.status, r.data.completion.id)
					);
					return r.data.completion;
				}
				if (r.queued) {
					// Offline: the tap is saved on this device and goes out when we reconnect.
					say('Saved! It will count as soon as we are back online.');
					return { id: null, status: 'pending' };
				}
				throw new Error(String(r.status));
			})
			.catch(() => {
				patch(memberId, (g) => setStatus(g, chore.id, 'none', null));
				jarStars[bucket] = Math.max(0, jarStars[bucket] - chore.stars);
				dropUndo(key);
				say('Oops, that did not save. Tap again when you are ready!');
				return null;
			})
			.finally(() => {
				delete inflight[key];
				void loadStars(memberId).catch(() => {});
			});
		inflight[key] = request;
	}

	async function undo(chore: KidChore) {
		const memberId = selectedId;
		if (!memberId) return;
		const key = tapKey(memberId, chore.id);
		const jarStars = starsOf(memberId);
		const pendingRequest = inflight[key];
		const startedAt = undoStarts[key] ?? Date.now();
		// No-approval chores are already gold: take the star back out of the jar.
		const bucket = chore.status === 'approved' ? 'balance' : 'pending';
		patch(memberId, (g) => setStatus(g, chore.id, 'none', null));
		jarStars[bucket] = Math.max(0, jarStars[bucket] - chore.stars);
		dropUndo(key);
		const completion = pendingRequest ? await pendingRequest : { id: chore.completionId };
		if (!completion) return;
		if (!completion.id) {
			// The tap is still waiting in the queue: taking it back just means never sending it.
			await writeQueue.cancelComplete(chore.id);
			return;
		}
		const r = await deliver({
			kind: 'undo',
			url: `/api/completions/${completion.id}/undo`,
			body: {},
			choreId: chore.id,
			expiresAt: startedAt + UNDO_WINDOW_MS
		});
		if (!r.sent && !r.queued) {
			patch(memberId, (g) => setStatus(g, chore.id, chore.status, completion.id));
			jarStars[bucket] += chore.stars;
			say('Hmm, that one is already with the grown-ups.');
		}
		void loadStars(memberId).catch(() => {});
	}
</script>

<svelte:head>
	<title>{todo} · Home Hub</title>
</svelte:head>

{#if !loaded}
	<div class="h-full" aria-busy="true"></div>
{:else if unreachable}
	<EmptyState
		icon="chores"
		title={todo}
		line="Hmm, we cannot reach the hub right now. Your to-dos will show up as soon as we can."
	/>
{:else if members.length === 0}
	<EmptyState
		icon="chores"
		title={todo}
		line="No one is here yet. Grown-ups: add your family in Settings, then Family."
	/>
{:else if selected}
	<h1 class="sr-only">{todo}</h1>
	<div
		class="flex min-h-full flex-col gap-4 p-6 short:grid short:grid-cols-kid-short short:items-start short:gap-2 short:p-2 tablet:p-4"
	>
		<div class="flex flex-wrap items-center gap-x-6 gap-y-3 short:contents tablet:gap-x-4">
			{#if kids.length > 1}
				<nav
					aria-label="Whose to-dos?"
					data-testid="child-switcher"
					class="flex max-h-tap-kid-lg flex-wrap gap-4 overflow-y-auto short:col-start-1 short:row-span-3 short:row-start-1 short:max-h-none short:flex-col short:flex-nowrap short:gap-2 tablet:max-h-none tablet:max-w-3/5 tablet:flex-nowrap tablet:gap-3 tablet:overflow-x-auto tablet:p-1"
				>
					{#each kids as kid (kid.id)}
						<button
							type="button"
							aria-label={kid.name}
							aria-pressed={kid.id === selected.id}
							onclick={() => choose(kid.id)}
							class="flex min-h-tap-kid min-w-tap-kid flex-col items-center justify-center rounded-card p-1 transition-transform duration-150 active:scale-95 {kid.id ===
							selected.id
								? 'bg-surface-raised shadow-raised ring-4 ring-ink'
								: ''}"
						>
							<MemberAvatar name={kid.name} color={kid.color} avatar={kid.avatar} size="kid" />
						</button>
					{/each}
				</nav>
			{/if}
			<div
				class="flex min-w-0 grow flex-wrap items-center gap-x-6 gap-y-2 short:col-start-3 short:row-start-1 short:grow-0 short:flex-col short:items-start short:gap-1"
			>
				<div class="flex min-w-0 items-center gap-4">
					{#if kids.length <= 1}
						<span class="contents short:hidden">
							<MemberAvatar
								name={selected.name}
								color={selected.color}
								avatar={selected.avatar}
								size="lg"
							/>
						</span>
					{/if}
					<p
						class="min-w-0 text-title leading-tight font-extrabold break-words short:text-body tablet:text-lead"
					>
						Hi, {selected.name}!
					</p>
				</div>
				{#if partial}
					<p data-testid="partial-note" role="status" class="text-caption text-ink-muted">
						Some Star Jobs could not refresh. Trying again soon.
					</p>
				{/if}
				{#if !onVacation}
					<div class="flex flex-col gap-1 tablet:flex-row tablet:items-center tablet:gap-3">
						<div class="flex flex-wrap items-center gap-3 short:gap-1">
							<p
								data-testid="star-jobs"
								class="flex items-center gap-2 rounded-chip bg-job-soft px-4 py-1 text-body font-extrabold short:px-2 short:text-caption tablet:px-3 tablet:text-caption"
							>
								<span aria-hidden="true">⭐</span>
								{#if jobGroups.length === 0}
									No Star Jobs today.
								{:else}
									Star Jobs
									<span data-testid="star-jobs-count" aria-label="{jobs.done} of {jobs.total} done"
										>{jobs.done}/{jobs.total}</span
									>
								{/if}
							</p>
							{#if habitsToday.total > 0}
								<p
									data-testid="habits"
									class="flex items-center gap-2 rounded-chip bg-habit-soft px-4 py-1 text-body font-extrabold short:px-2 short:text-caption tablet:px-3 tablet:text-caption"
								>
									<span aria-hidden="true">✅</span>
									Habits
									<span
										data-testid="habits-count"
										aria-label="{habitsToday.done} of {habitsToday.total} done"
										>{habitsToday.done}/{habitsToday.total}</span
									>
								</p>
							{/if}
						</div>
						{#if habitsToday.total > 0}
							<p class="text-caption text-ink-muted" data-testid="habit-week">
								{#if habitWeek?.starEarned}
									All done today: you earned a star ⭐
								{:else}
									Do them all today for a star ⭐
								{/if}
								{#if habitWeek && habitWeek.due > 0}
									· This week {habitWeek.done} of {habitWeek.due}
								{/if}
							</p>
						{/if}
					</div>
				{/if}
				<div class="ml-auto short:ml-0">
					<PracticeLog
						memberId={selected.id}
						{jar}
						onstars={(delta) => {
							const jarStars = starsOf(selected.id);
							jarStars.balance = Math.max(0, jarStars.balance + delta);
						}}
						onchanged={() => void loadStars(selected.id).catch(() => {})}
						{say}
					/>
				</div>
				{#if streak && streak.days > 0 && !onVacation}
					<div class="ml-auto short:ml-0">
						<StreakBadge days={streak.days} nextDays={streak.next?.days ?? null} />
					</div>
				{/if}
			</div>
		</div>

		<div class="short:col-start-3 short:row-start-2">
			<StarJar
				memberId={selected.id}
				onchanged={() => void loadStars(selected.id).catch(() => {})}
				balance={stars.balance}
				pending={stars.pending}
				{goal}
				bind:jar
			/>
		</div>

		<div class="flex grow flex-col short:col-start-2 short:row-span-3 short:row-start-1">
			{#if onVacation}
				<VacationCard days={streak?.days ?? 0} back={page.data.vacation?.back ?? null} />
			{:else if jobGroups.length === 0 && habitsToday.total === 0}
				<div
					class="flex grow flex-col items-center justify-center gap-6 py-16 text-center"
					data-testid="all-free"
				>
					<p class="text-display leading-none" aria-hidden="true">🎉</p>
					<p class="text-headline leading-none font-extrabold">All free today!</p>
					<p class="text-lead text-ink-muted">Nothing to do today. Go play!</p>
				</div>
			{:else}
				<!-- Morning | After school | Tonight side by side; stacked, with Now first, when narrow. -->
				<div
					data-testid="todo-columns"
					class="grid grow grid-cols-1 content-start gap-4 landscape:grid-cols-3 short:grid-cols-1 short:gap-2 tablet:grid-cols-1 tablet:gap-2"
				>
					{#each columns as col (col.key)}
						{@render column(col)}
					{/each}
				</div>
			{/if}
		</div>
	</div>
{/if}

{#if player}
	{@const current = player}
	<RoutinePlayer
		routine={current}
		ondone={(i) => routineDone(current, i)}
		onclose={() => (playing = null)}
	/>
{/if}

{#if allDone}
	<AllDoneBanner />
{/if}

{#if earned}
	<EarnedBanner title={earned.title} image={earned.image} />
{/if}

{#if streakParty}
	<StreakBanner days={streakParty.days} stars={streakParty.stars} />
{/if}

{#if stickerParty}
	<StickerBanner emoji={stickerParty.emoji} title={stickerParty.title} />
{/if}

{#if bonusParty}
	<BonusBanner stars={bonusParty.stars} note={bonusParty.note} />
{/if}

{#if message}
	<p
		role="status"
		data-testid="gentle-message"
		class="fixed bottom-12 left-1/2 z-10 max-w-3xl -translate-x-1/2 rounded-card bg-ink px-10 py-6 text-center text-lead font-bold text-surface shadow-float portrait:tablet:bottom-28"
	>
		{message}
	</p>
{/if}

{#snippet column(col: TimeColumn)}
	{#if selected}
		<section
			aria-labelledby="col-{col.key}"
			data-testid="time-column"
			data-column={col.key}
			data-now={col.now}
			class="flex min-w-0 flex-col gap-2 rounded-card p-2 {col.now
				? 'bg-surface-sunken'
				: ''} {COLUMN_ORDER_CLASS[col.key]}"
		>
			<h2
				id="col-{col.key}"
				class="flex items-center gap-3 px-1 text-lead leading-none font-extrabold short:text-body"
			>
				{col.label}
				{#if col.now}
					<span
						class="rounded-chip bg-accent px-3 py-1 text-caption font-extrabold text-on-accent"
						data-testid="now-tag">Now</span
					>
				{/if}
			</h2>
			{#each col.routines as r (r.id)}
				<button
					type="button"
					onclick={() => (playing = r.id)}
					data-testid="routine-button"
					class="flex min-h-tap-kid w-full items-center gap-3 rounded-card border-4 border-habit-line bg-surface-raised px-3 py-2 text-left transition-transform duration-75 active:scale-95"
				>
					<span class="size-14 shrink-0 text-habit"
						><RoutineIcon name={r.steps[0]?.icon ?? 'star'} /></span
					>
					<span
						class="min-w-0 grow text-body leading-tight font-extrabold break-words short:text-caption"
						>{r.name}</span
					>
					<span
						class="shrink-0 rounded-chip bg-habit px-4 py-2 text-caption font-extrabold text-on-accent"
						>Start</span
					>
				</button>
			{/each}
			{@render rows(col.chores)}
			{#if col.weekly.length > 0}
				<h3 class="px-1 pt-2 text-caption font-extrabold text-ink-muted">
					<span aria-hidden="true">{GROUP_HEADINGS.week.emoji}</span>
					{GROUP_HEADINGS.week.label}
				</h3>
				{@render rows(col.weekly)}
			{/if}
		</section>
	{/if}
{/snippet}

{#snippet rows(list: KidChore[])}
	{#if selected}
		{#each list as chore (chore.id)}
			{@const key = tapKey(selected.id, chore.id)}
			<TodoRow
				{chore}
				undoStartedAt={undoStarts[key] ?? null}
				ondone={done}
				onundo={undo}
				onundoexpire={() => dropUndo(key)}
			/>
		{/each}
	{/if}
{/snippet}
