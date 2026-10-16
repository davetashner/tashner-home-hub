<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { deliver, onWriteDropped, writeQueue } from '#lib/offline/client.js';
	import { offline } from '#lib/offline/state.svelte.js';
	import { page } from '$app/state';
	import MemberAvatar from '#lib/components/MemberAvatar.svelte';
	import ChoreCard from '#lib/components/kid/ChoreCard.svelte';
	import StarJar, { type Goal } from '#lib/components/kid/StarJar.svelte';
	import AllDoneBanner from '#lib/components/kid/AllDoneBanner.svelte';
	import EarnedBanner from '#lib/components/kid/EarnedBanner.svelte';
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
		localDate,
		setStatus,
		UNDO_WINDOW_MS,
		switcherMembers,
		type KidChore,
		type KidGroup
	} from '#lib/domain/kid-chores.js';
	import { overlayQueued } from '#lib/domain/write-queue.js';

	interface Member {
		id: string;
		name: string;
		color: MemberColor;
		avatar: string | null;
	}
	type Completion = { id: string | null; status: KidChore['status'] };

	const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

	let loaded = $state(false);
	let members = $state<Member[]>([]);
	let boards = $state<Record<string, KidGroup[]>>({});
	let selectedId = $state<string | null>(null);
	let stars = $state({ balance: 0, pending: 0 });
	let goal = $state<Goal | null>(null);
	let jar = $state<HTMLElement | null>(null);
	let message = $state<string | null>(null);
	let undoStarts = $state<Record<string, number>>({});
	let allDone = $state(false);
	let allDoneTimer: ReturnType<typeof setTimeout> | undefined;
	let allDoneUntil = 0;
	let earned = $state<Goal | null>(null);
	let earnedTimer: ReturnType<typeof setTimeout> | undefined;
	// Fallback when localStorage is unavailable, so the party still happens only once per load.
	const earnedMemo: Record<string, string | null> = {};

	// Taps whose POST has not answered yet: choreId -> completion promise.
	const inflight: Record<string, Promise<Completion | null>> = {};
	const busy = () => Object.keys(inflight).length > 0;
	let messageTimer: ReturnType<typeof setTimeout> | undefined;

	const selected = $derived(members.find((m) => m.id === selectedId) ?? null);
	const groups = $derived(selectedId ? (boards[selectedId] ?? []) : []);

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
			api<{ balance: number; pending: number }>(`/api/members/${id}/stars?limit=1`),
			api<{ reward: Goal } | null>(`/api/members/${id}/goal`)
		]);
		if (id !== selectedId) return;
		stars = { balance: s.balance, pending: s.pending };
		goal = g && {
			id: g.reward.id,
			title: g.reward.title,
			image: g.reward.image,
			cost: g.reward.cost
		};
		checkEarned(id);
	}

	/** "You earned it!" once per reaching the goal (REW-3), after any all-done party. */
	function checkEarned(memberId: string) {
		const key = earnedKey(memberId);
		let stored = earnedMemo[key] ?? null;
		try {
			stored = localStorage.getItem(key);
		} catch {
			// no storage: use the in-memory memo
		}
		const reward = goal;
		const decision = earnedDecision(
			stored,
			reward && { rewardId: reward.id, cost: reward.cost, balance: stars.balance }
		);
		earnedMemo[key] = decision.store;
		try {
			if (decision.store === null) localStorage.removeItem(key);
			else localStorage.setItem(key, decision.store);
		} catch {
			// memo only
		}
		if (!decision.celebrate || !reward) return;
		clearTimeout(earnedTimer);
		earnedTimer = setTimeout(
			() => {
				earned = reward;
				celebrateGoal(jar);
				earnedTimer = setTimeout(() => (earned = null), 4500);
			},
			Math.max(0, allDoneUntil - Date.now()) + 300
		);
	}

	async function refresh() {
		if (busy()) return;
		try {
			const list = await api<Member[]>('/api/members');
			const date = localDate(Date.now(), tz);
			const entries = await Promise.all(
				list.map(
					async (m) =>
						[
							m.id,
							await api<KidGroup[]>(
								`/api/members/${m.id}/chores?date=${date}&tz=${encodeURIComponent(tz)}`
							)
						] as const
				)
			);
			if (busy()) return;
			const queued = await writeQueue.pending();
			const approved = selectedId
				? approvedTransitions(
						boards[selectedId],
						entries.find(([id]) => id === selectedId)?.[1] ?? []
					)
				: { count: 0, stars: 0 };
			members = list;
			boards = Object.fromEntries(
				entries.map(([id, g]) => [id, overlayQueued(g, id, queued)] as const)
			);
			const options = switcherMembers(list, boards);
			if (!options.some((m) => m.id === selectedId)) {
				// ?member=<id> picks a child until the avatar switcher lands (follow-up).
				const want = page.url.searchParams.get('member');
				selectedId = (options.find((m) => m.id === want) ?? options[0])?.id ?? null;
			}
			if (selectedId) await loadStars(selectedId);
			if (approved.count > 0) {
				await tick();
				celebrateApproval(jar, approved.stars);
			}
		} catch {
			if (!loaded) say('Hmm, I could not load your chores. Trying again soon!');
		} finally {
			loaded = true;
		}
	}

	// Queued taps just reached the server: pick up the real state.
	$effect(() => {
		if (offline.synced > 0) void refresh();
	});

	onMount(() => {
		onWriteDropped(() => {
			say('Hmm, that one is already with the grown-ups.');
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
		};
	});

	function patch(memberId: string, fn: (g: KidGroup[]) => KidGroup[]) {
		boards[memberId] = fn(boards[memberId] ?? []);
	}

	function dropUndo(choreId: string) {
		undoStarts = Object.fromEntries(Object.entries(undoStarts).filter(([k]) => k !== choreId));
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
		patch(memberId, (g) => setStatus(g, chore.id, 'pending', null));
		stars.pending += chore.stars;
		undoStarts[chore.id] = Date.now();
		celebrate({ choreId: chore.id, memberId, stars: chore.stars, origin: card, jar });
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
				stars.pending = Math.max(0, stars.pending - chore.stars);
				dropUndo(chore.id);
				say('Oops, that did not save. Tap again when you are ready!');
				return null;
			})
			.finally(() => {
				delete inflight[chore.id];
				void loadStars(memberId).catch(() => {});
			});
		inflight[chore.id] = request;
	}

	async function undo(chore: KidChore) {
		const memberId = selectedId;
		if (!memberId) return;
		const pendingRequest = inflight[chore.id];
		const startedAt = undoStarts[chore.id] ?? Date.now();
		// No-approval chores are already gold: take the star back out of the jar.
		const bucket = chore.status === 'approved' ? 'balance' : 'pending';
		patch(memberId, (g) => setStatus(g, chore.id, 'none', null));
		stars[bucket] = Math.max(0, stars[bucket] - chore.stars);
		dropUndo(chore.id);
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
			stars[bucket] += chore.stars;
			say('Hmm, that one is already with the grown-ups.');
		}
		void loadStars(memberId).catch(() => {});
	}
</script>

<svelte:head>
	<title>My chores · Home Hub</title>
</svelte:head>

{#if !loaded}
	<div class="h-full" aria-busy="true"></div>
{:else if members.length === 0}
	<EmptyState
		icon="chores"
		title="Chores"
		line="No one is here yet. Grown-ups: add your family in Settings, then Family."
	/>
{:else if selected}
	<h1 class="sr-only">Chores</h1>
	<div
		class="flex min-h-full flex-col gap-10 p-12 portrait:p-10 landscape:flex-row landscape:items-start"
	>
		<div class="flex min-w-0 grow flex-col gap-10 portrait:contents">
			<header class="flex flex-wrap items-center gap-8 portrait:order-1">
				<div class="flex items-center gap-6">
					<MemberAvatar
						name={selected.name}
						color={selected.color}
						avatar={selected.avatar}
						size="lg"
					/>
					<p class="text-headline leading-none font-extrabold">Hi, {selected.name}!</p>
				</div>
			</header>

			<div class="flex grow flex-col gap-10 portrait:order-3">
				{#if groups.length === 0}
					<div
						class="flex grow flex-col items-center justify-center gap-6 py-16 text-center"
						data-testid="all-free"
					>
						<p class="text-display leading-none" aria-hidden="true">🎉</p>
						<p class="text-headline leading-none font-extrabold">All free today!</p>
						<p class="text-lead text-ink-muted">No chores today. Go play!</p>
					</div>
				{:else}
					{#each groups as group (group.timeOfDay)}
						<section aria-labelledby="g-{group.timeOfDay}" class="flex flex-col gap-6">
							<h2 id="g-{group.timeOfDay}" class="text-title leading-none font-extrabold">
								<span aria-hidden="true">{GROUP_HEADINGS[group.timeOfDay].emoji}</span>
								{GROUP_HEADINGS[group.timeOfDay].label}
							</h2>
							<div class="flex flex-col gap-6">
								{#each group.chores as chore (chore.id)}
									<ChoreCard
										{chore}
										undoStartedAt={undoStarts[chore.id] ?? null}
										ondone={done}
										onundo={undo}
										onundoexpire={(c) => dropUndo(c.id)}
									/>
								{/each}
							</div>
						</section>
					{/each}
				{/if}
			</div>
		</div>

		<aside class="shrink-0 portrait:order-first landscape:sticky landscape:top-0 landscape:w-1/3">
			<StarJar balance={stars.balance} pending={stars.pending} {goal} bind:jar />
		</aside>
	</div>
{/if}

{#if allDone}
	<AllDoneBanner />
{/if}

{#if earned}
	<EarnedBanner title={earned.title} image={earned.image} />
{/if}

{#if message}
	<p
		role="status"
		data-testid="gentle-message"
		class="fixed bottom-12 left-1/2 z-10 max-w-3xl -translate-x-1/2 rounded-card bg-ink px-10 py-6 text-center text-lead font-bold text-surface shadow-float"
	>
		{message}
	</p>
{/if}
