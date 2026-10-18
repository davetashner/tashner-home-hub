<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import MemberAvatar from '#lib/components/MemberAvatar.svelte';
	import type { MemberColor } from '#lib/domain/member-colors.js';

	/** Games and Music wait behind this while the kid chosen on this screen has missed a job (hub-ruz). */
	let { onlock }: { onlock: (locked: boolean) => void } = $props();

	interface Lock {
		memberId: string;
		locked: boolean;
		remaining: { id: string; title: string; icon: string | null }[];
		missed: string[];
	}
	interface Kid {
		id: string;
		name: string;
		role: string;
		color: MemberColor;
		avatar: string | null;
	}

	const KID_KEY = 'hub.kid';
	let locks = $state<Lock[]>([]);
	let kids = $state<Kid[]>([]);
	let chosen = $state<string | null>(null);

	function remembered(): string | null {
		try {
			return localStorage.getItem(KID_KEY);
		} catch {
			return null;
		}
	}

	onMount(() => {
		chosen = page.url.searchParams.get('member') ?? remembered();
		void (async () => {
			// Offline or failing: never block play on the network, show the tab.
			const [lockRes, memberRes] = await Promise.all([
				fetch('/api/fun-lock').catch(() => null),
				fetch('/api/members').catch(() => null)
			]);
			if (lockRes?.ok) locks = (await lockRes.json()) as Lock[];
			if (memberRes?.ok)
				kids = ((await memberRes.json()) as Kid[]).filter((m) => m.role === 'child');
		})();
	});

	// Only the kid this screen is for (picked on Chores, or ?member=) is held back; a screen that
	// does not know who is using it never blocks anyone.
	const lock = $derived(locks.find((l) => l.memberId === chosen && l.locked) ?? null);
	$effect(() => {
		onlock(lock !== null);
	});
	const kid = $derived(kids.find((k) => k.id === chosen) ?? null);

	function choose(id: string) {
		chosen = id;
		try {
			localStorage.setItem(KID_KEY, id);
		} catch {
			// Storage unavailable: the choice only lasts for this visit.
		}
	}
</script>

{#if lock && kids.length > 1}
	<div
		class="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-4 px-8 pt-8 max-sm:px-3 max-sm:pt-3"
		role="group"
		aria-label="Who is this for?"
		data-testid="fun-kids"
	>
		{#each kids as k (k.id)}
			<button
				type="button"
				onclick={() => choose(k.id)}
				aria-pressed={k.id === chosen}
				data-testid="fun-kid-{k.id}"
				class="press flex min-h-tap-kid items-center gap-3 rounded-chip border-4 bg-surface-raised pr-6 pl-2 text-lead font-extrabold {k.id ===
				chosen
					? 'border-accent'
					: 'border-transparent'}"
			>
				<MemberAvatar name={k.name} color={k.color} avatar={k.avatar} />
				{k.name}
			</button>
		{/each}
	</div>
{/if}

{#if lock}
	<section
		class="mx-auto flex w-full max-w-4xl flex-col gap-8 p-8 max-sm:p-3 short:gap-4 short:p-3"
		data-testid="fun-locked"
	>
		<h1 class="text-headline leading-none font-extrabold">Finish your jobs first</h1>
		<p class="text-lead text-ink-muted">
			{kid ? `${kid.name}, you` : 'You'} missed {lock.missed.join(', ')}. Do today's jobs to unlock
			this tab, or ask a grown-up.
		</p>
		<ul class="flex flex-col gap-4" data-testid="fun-remaining">
			{#each lock.remaining as job (job.id)}
				<li
					class="flex min-h-tap-kid items-center gap-4 rounded-card bg-surface-raised px-6 shadow-raised"
				>
					<span aria-hidden="true" class="text-title">{job.icon ?? '⭐'}</span>
					<span class="text-lead font-extrabold">{job.title}</span>
				</li>
			{/each}
		</ul>
		<a
			href={resolve(`/(app)/chores?member=${encodeURIComponent(lock.memberId)}`)}
			data-testid="fun-go-jobs"
			class="press inline-flex min-h-tap-kid items-center self-start rounded-card bg-accent px-12 text-title font-extrabold text-on-accent shadow-raised"
		>
			Go to my jobs
		</a>
	</section>
{/if}
