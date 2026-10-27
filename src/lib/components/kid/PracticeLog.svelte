<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import {
		nextStarLine,
		starsForLog,
		starsForMinutes,
		stepMinutes,
		minutesToNextStar,
		type PracticeRate
	} from '#lib/domain/practice.js';
	import { UNDO_WINDOW_MS } from '#lib/domain/kid-chores.js';
	import { celebrate } from './celebrate.js';

	interface Summary {
		activityId: string;
		name: string;
		emoji: string | null;
		rate: PracticeRate;
		minutesToday: number;
		starsToday: number;
		minutesToNextStar: number | null;
		capReached: boolean;
		lastLog: { id: string; minutes: number; stars: number; createdAt: number } | null;
	}

	/**
	 * "Log reading" for the kid screen (hub-kko.2): pick an activity, pick minutes, Save. The stars
	 * show at once and roll back if the server says no. No grown-up needed.
	 */
	let {
		memberId,
		jar,
		onstars,
		onchanged,
		say
	}: {
		memberId: string;
		jar: HTMLElement | null;
		/** Moves the jar's gold count right now (optimistic), by a signed amount. */
		onstars: (delta: number) => void;
		/** The server's answer is in: refresh the real balance. */
		onchanged: () => void;
		say: (text: string) => void;
	} = $props();

	const CHIPS = [10, 15, 20, 30];
	let summaries = $state<Summary[]>([]);
	let open = $state(false);
	let activityId = $state<string | null>(null);
	let minutes = $state(15);
	// The last save, kept for the undo window.
	let undo = $state<{ id: string | null; activityId: string; stars: number; at: number } | null>(
		null
	);
	let undoTimer: ReturnType<typeof setTimeout> | undefined;
	let saving: Promise<void> | null = null;

	const chosen = $derived(summaries.find((s) => s.activityId === activityId) ?? null);
	const total = $derived(summaries.reduce((n, s) => n + s.starsToday, 0));

	onMount(() => {
		void load();
		return () => clearTimeout(undoTimer);
	});

	// A different kid on screen: forget the last one's summaries and undo.
	let shownFor = '';
	$effect(() => {
		if (shownFor === memberId) return;
		shownFor = memberId;
		summaries = [];
		undo = null;
		activityId = null;
		void load();
	});

	async function load() {
		const id = memberId;
		try {
			const res = await fetch(`/api/members/${id}/practice-logs`);
			if (!res.ok || id !== memberId) return;
			summaries = (await res.json()) as Summary[];
		} catch {
			// Offline: keep what we have; the button simply stays hidden until we can ask.
		}
	}

	function show() {
		activityId = summaries.some((s) => s.activityId === activityId)
			? activityId
			: (summaries[0]?.activityId ?? null);
		open = true;
	}

	function patchSummary(id: string, minutesToday: number) {
		summaries = summaries.map((s) => {
			if (s.activityId !== id) return s;
			const next = minutesToNextStar(s.rate, minutesToday);
			return {
				...s,
				minutesToday,
				starsToday: starsForMinutes(s.rate, minutesToday),
				minutesToNextStar: next,
				capReached: next === null
			};
		});
	}

	function save(button: HTMLElement) {
		const s = chosen;
		if (!s || saving) return;
		const mins = minutes;
		const stars = starsForLog(s.rate, s.minutesToday, mins);
		const before = s.minutesToday;
		// Optimistic: stars, counters and celebration first, then the network.
		patchSummary(s.activityId, before + mins);
		if (stars > 0) {
			onstars(stars);
			celebrate({ choreId: 'practice', memberId, stars, origin: button, jar, gold: true });
		}
		open = false;
		const mine = { id: null as string | null, activityId: s.activityId, stars, at: Date.now() };
		undo = mine;
		clearTimeout(undoTimer);
		undoTimer = setTimeout(() => {
			if (undo === mine) undo = null;
		}, UNDO_WINDOW_MS);
		const request = fetch(`/api/members/${memberId}/practice-logs`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ activityId: s.activityId, minutes: mins })
		})
			.then(async (res) => {
				if (!res.ok) throw new Error(String(res.status));
				const body = (await res.json()) as { log: { id: string }; summary: Summary };
				mine.id = body.log.id;
				summaries = summaries.map((x) =>
					x.activityId === body.summary.activityId ? body.summary : x
				);
			})
			.catch(() => {
				patchSummary(s.activityId, before);
				if (stars > 0) onstars(-stars);
				if (undo === mine) undo = null;
				say('Oops, that did not save. Try again when you are ready!');
			})
			.finally(() => {
				saving = null;
				onchanged();
			});
		saving = request;
	}

	async function takeBack() {
		const u = undo;
		if (!u) return;
		undo = null;
		clearTimeout(undoTimer);
		await saving;
		const target = summaries.find((s) => s.activityId === u.activityId);
		const logged = target?.lastLog;
		if (!u.id) return;
		const mins = logged?.id === u.id ? logged.minutes : 0;
		if (target) patchSummary(u.activityId, Math.max(0, target.minutesToday - mins));
		if (u.stars > 0) onstars(-u.stars);
		const res = await fetch(`/api/members/${memberId}/practice-logs`, {
			method: 'DELETE',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ logId: u.id })
		}).catch(() => null);
		if (!res?.ok) say('Hmm, that one is already with the grown-ups.');
		await load();
		onchanged();
	}
</script>

{#if summaries.length > 0}
	<div class="flex flex-col gap-2" data-testid="practice">
		<button
			type="button"
			data-testid="practice-open"
			onclick={show}
			class="flex min-h-tap-kid w-full items-center gap-3 rounded-card border-4 border-habit-line bg-habit-soft px-4 py-2 text-left transition-transform duration-75 active:scale-95"
		>
			<span class="text-headline leading-none" aria-hidden="true">📖</span>
			<span class="flex min-w-0 grow flex-col">
				<span class="text-body leading-tight font-extrabold">Log reading &amp; practice</span>
				<span class="text-caption text-ink-muted" data-testid="practice-today">
					{#if total > 0}Today: {total} {total === 1 ? 'star' : 'stars'}{:else}Tell us what you did!{/if}
				</span>
			</span>
		</button>
		{#if undo}
			<div
				data-testid="practice-undo-row"
				class="flex min-h-tap-kid items-center justify-between gap-3 rounded-card bg-success-soft px-4 py-2"
			>
				<p role="status" class="min-w-0 text-body font-extrabold">
					Saved!{undo.stars > 0 ? ` +${undo.stars} ⭐` : ''}
				</p>
				<Button
					variant="secondary"
					size="kid"
					class="!text-body"
					data-testid="practice-undo"
					onclick={takeBack}
				>
					Undo
				</Button>
			</div>
		{/if}
	</div>
{/if}

{#if open}
	<div
		class="fixed inset-0 z-20 flex items-end justify-center bg-ink/50 p-0 sm:items-center sm:p-8"
	>
		<div
			role="dialog"
			aria-modal="true"
			aria-label="Log reading and practice"
			data-testid="practice-sheet"
			class="sheet flex max-h-full w-full max-w-5xl flex-col gap-4 overflow-y-auto overscroll-contain rounded-t-sheet bg-surface-raised p-8 pb-safe-8 shadow-float sm:rounded-sheet short:gap-2 short:p-4"
		>
			<header class="flex items-center justify-between gap-6">
				<h2 class="text-title leading-none font-extrabold">How long?</h2>
				<Button
					variant="secondary"
					size="kid"
					data-testid="practice-close"
					onclick={() => (open = false)}
				>
					Close
				</Button>
			</header>

			<div class="flex flex-wrap gap-3" role="group" aria-label="What did you do?">
				{#each summaries as s (s.activityId)}
					<button
						type="button"
						data-testid="practice-activity"
						aria-pressed={s.activityId === activityId}
						onclick={() => (activityId = s.activityId)}
						class="flex min-h-tap-kid-lg min-w-tap-kid-lg grow basis-0 flex-col items-center justify-center gap-1 rounded-card border-4 px-4 py-2 transition-transform duration-75 active:scale-95 short:min-h-tap-kid {s.activityId ===
						activityId
							? 'border-ink bg-star-soft'
							: 'border-line bg-surface-raised'}"
					>
						<span class="text-headline leading-none" aria-hidden="true">{s.emoji ?? '📚'}</span>
						<span class="text-body leading-tight font-extrabold break-words">{s.name}</span>
					</button>
				{/each}
			</div>

			<div class="flex flex-wrap gap-3" role="group" aria-label="Minutes">
				{#each CHIPS as c (c)}
					<button
						type="button"
						data-testid="practice-chip"
						aria-pressed={minutes === c}
						onclick={() => (minutes = c)}
						class="min-h-tap-kid min-w-tap-kid grow rounded-card border-4 px-4 text-title leading-none font-extrabold transition-transform duration-75 active:scale-95 {minutes ===
						c
							? 'border-ink bg-star-soft'
							: 'border-line bg-surface-raised'}"
					>
						{c}
					</button>
				{/each}
			</div>

			<div class="flex items-center justify-center gap-4">
				<Button
					variant="secondary"
					size="kid"
					aria-label="5 minutes less"
					data-testid="practice-minus"
					onclick={() => (minutes = stepMinutes(minutes, -1))}>-5</Button
				>
				<p
					class="min-w-40 text-center text-title leading-none font-extrabold"
					data-testid="practice-minutes"
				>
					{minutes} <span class="text-lead">min</span>
				</p>
				<Button
					variant="secondary"
					size="kid"
					aria-label="5 minutes more"
					data-testid="practice-plus"
					onclick={() => (minutes = stepMinutes(minutes, 1))}>+5</Button
				>
			</div>

			{#if chosen}
				{@const gain = starsForLog(chosen.rate, chosen.minutesToday, minutes)}
				<p class="text-center text-lead font-extrabold" data-testid="practice-hint">
					{#if chosen.capReached}
						{nextStarLine(null)}
					{:else if gain > 0}
						You will earn {gain} {gain === 1 ? 'star' : 'stars'} ⭐
					{:else}
						{nextStarLine(chosen.minutesToNextStar)}
					{/if}
				</p>
			{/if}

			<Button
				size="kid"
				class="w-full"
				data-testid="practice-save"
				disabled={!chosen}
				onclick={(e: MouseEvent) => save(e.currentTarget as HTMLElement)}
			>
				Save {minutes} minutes
			</Button>
		</div>
	</div>
{/if}

<style>
	.sheet {
		animation: sheet-up var(--duration-base) var(--ease-out-soft) both;
	}
	@keyframes sheet-up {
		from {
			transform: translateY(2rem);
			opacity: 0;
		}
	}
</style>
