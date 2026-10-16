<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import MemberAvatar from '#lib/components/MemberAvatar.svelte';
	import ChoreCard from '#lib/components/kid/ChoreCard.svelte';
	import StarJar, { type Goal } from '#lib/components/kid/StarJar.svelte';
	import { celebrate } from '#lib/components/kid/celebrate.js';
	import EmptyState from '#lib/components/shell/EmptyState.svelte';
	import type { MemberColor } from '#lib/domain/member-colors.js';
	import {
		GROUP_HEADINGS,
		localDate,
		setStatus,
		switcherMembers,
		type KidChore,
		type KidGroup
	} from '#lib/domain/kid-chores.js';

	interface Member {
		id: string;
		name: string;
		color: MemberColor;
		avatar: string | null;
	}
	type Completion = { id: string; status: KidChore['status'] };

	const REFRESH_MS = 60_000;
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

	// Taps whose POST has not answered yet: choreId -> completion promise.
	const inflight: Record<string, Promise<Completion | null>> = {};
	const busy = () => Object.keys(inflight).length > 0;
	let messageTimer: ReturnType<typeof setTimeout> | undefined;

	const selected = $derived(members.find((m) => m.id === selectedId) ?? null);
	const groups = $derived(selectedId ? (boards[selectedId] ?? []) : []);

	async function api<T>(url: string, body?: object): Promise<T> {
		const res = await fetch(
			url,
			body && {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			}
		);
		if (!res.ok) throw new Error(String(res.status));
		return (await res.json()) as T;
	}

	function say(text: string) {
		message = text;
		clearTimeout(messageTimer);
		messageTimer = setTimeout(() => (message = null), 5000);
	}

	async function loadStars(id: string) {
		const [s, g] = await Promise.all([
			api<{ balance: number; pending: number }>(`/api/members/${id}/stars?limit=1`),
			api<(Goal & { reward: Goal }) | null>(`/api/members/${id}/goal`)
		]);
		if (id !== selectedId) return;
		stars = { balance: s.balance, pending: s.pending };
		goal = g && { ...g, ...g.reward };
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
			members = list;
			boards = Object.fromEntries(entries);
			const options = switcherMembers(list, boards);
			if (!options.some((m) => m.id === selectedId)) {
				// ?member=<id> picks a child until the avatar switcher lands (follow-up).
				const want = page.url.searchParams.get('member');
				selectedId = (options.find((m) => m.id === want) ?? options[0])?.id ?? null;
			}
			if (selectedId) await loadStars(selectedId);
		} catch {
			if (!loaded) say('Hmm, I could not load your chores. Trying again soon!');
		} finally {
			loaded = true;
		}
	}

	onMount(() => {
		void refresh();
		const onVisible = () => document.visibilityState === 'visible' && void refresh();
		document.addEventListener('visibilitychange', onVisible);
		const timer = setInterval(() => void refresh(), REFRESH_MS);
		return () => {
			document.removeEventListener('visibilitychange', onVisible);
			clearInterval(timer);
			clearTimeout(messageTimer);
		};
	});

	function patch(memberId: string, fn: (g: KidGroup[]) => KidGroup[]) {
		boards[memberId] = fn(boards[memberId] ?? []);
	}

	function dropUndo(choreId: string) {
		undoStarts = Object.fromEntries(Object.entries(undoStarts).filter(([k]) => k !== choreId));
	}

	function done(chore: KidChore, card: HTMLElement) {
		const memberId = selectedId;
		if (!memberId) return;
		patch(memberId, (g) => setStatus(g, chore.id, 'pending', null));
		stars.pending += chore.stars;
		undoStarts[chore.id] = Date.now();
		celebrate({ choreId: chore.id, memberId, stars: chore.stars, origin: card, jar });
		const request = api<{ completion: Completion }>(`/api/chores/${chore.id}/complete`, {
			memberId,
			date: localDate(Date.now(), tz)
		})
			.then(({ completion }) => {
				patch(memberId, (g) => setStatus(g, chore.id, completion.status, completion.id));
				return completion;
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
		patch(memberId, (g) => setStatus(g, chore.id, 'none', null));
		stars.pending = Math.max(0, stars.pending - chore.stars);
		dropUndo(chore.id);
		const completion = pendingRequest ? await pendingRequest : { id: chore.completionId };
		if (!completion?.id) return;
		try {
			await api(`/api/completions/${completion.id}/undo`, {});
		} catch {
			patch(memberId, (g) => setStatus(g, chore.id, 'pending', completion.id));
			stars.pending += chore.stars;
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

{#if message}
	<p
		role="status"
		data-testid="gentle-message"
		class="fixed bottom-12 left-1/2 z-10 max-w-3xl -translate-x-1/2 rounded-card bg-ink px-10 py-6 text-center text-lead font-bold text-surface shadow-float"
	>
		{message}
	</p>
{/if}
