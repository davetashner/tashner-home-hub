<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import type { ChoreInput, ChoreKind, ChoreView } from '#lib/server/domain/chores.js';
	import type { Member } from '#lib/server/domain/members.js';
	import Button from './ui/Button.svelte';
	import Card from './ui/Card.svelte';
	import ChoreForm from './ChoreForm.svelte';
	import MemberAvatar from './MemberAvatar.svelte';

	/** The settings list for one kind of item: Star Jobs or habits (hub-esf). */
	interface Props {
		kind: ChoreKind;
		chores: ChoreView[];
		members: Member[];
		heading: string;
		addLabel: string;
		empty: string;
	}
	let { kind, chores, members, heading, addLabel, empty }: Props = $props();
	const data = $derived({ chores, members });

	/** 'new', a chore id being edited, or null. */
	let editing = $state<string | null>(null);
	let archiving = $state<string | null>(null);
	let error = $state<string>();

	const close = () => {
		editing = null;
		archiving = null;
		error = undefined;
	};

	/** Sends a JSON request, refreshes the list, and returns an error message on failure. */
	async function send(url: string, method: string, body?: ChoreInput) {
		const res = await fetch(url, {
			method,
			headers: { 'content-type': 'application/json' },
			body: body && JSON.stringify(body)
		});
		if (!res.ok) {
			const err: { message?: string } = await res.json().catch(() => ({}));
			return err.message ?? 'Something went wrong.';
		}
		await invalidateAll();
		close();
	}

	const DAY_NAMES: Record<string, string> = {
		MO: 'Mon',
		TU: 'Tue',
		WE: 'Wed',
		TH: 'Thu',
		FR: 'Fri',
		SA: 'Sat',
		SU: 'Sun'
	};
	function describe(c: ChoreView) {
		const s = c.schedule;
		const when =
			s.type === 'once'
				? `Once, ${s.start}`
				: s.type === 'daily'
					? 'Every day'
					: s.type === 'weekdays'
						? s.days.map((d) => DAY_NAMES[d]).join(', ')
						: s.type === 'weekly'
							? 'Every week'
							: 'Every month';
		const reward =
			c.kind === 'habit' ? 'no stars' : `${c.stars} ${c.stars === 1 ? 'star' : 'stars'}`;
		return `${when} · ${c.timeOfDay} · ${reward}`;
	}
	const people = (c: ChoreView) =>
		c.memberIds.flatMap((id) => data.members.filter((m) => m.id === id));
</script>

<svelte:head><title>{heading}</title></svelte:head>

<section class="mx-auto flex max-w-4xl flex-col gap-6 p-6 max-sm:p-3">
	<header class="flex items-center justify-between gap-4">
		<h1 class="text-headline font-extrabold">{heading}</h1>
		{#if editing !== 'new'}
			<Button onclick={() => ((editing = 'new'), (archiving = null))}>{addLabel}</Button>
		{/if}
	</header>

	{#if editing === 'new'}
		<Card elevation="float">
			<ChoreForm
				choreKind={kind}
				members={data.members}
				onsave={(c) => send('/api/chores', 'POST', c)}
				oncancel={close}
			/>
		</Card>
	{/if}

	<ul class="flex flex-col gap-4" data-testid="chore-list">
		{#each data.chores as chore (chore.id)}
			<li>
				<Card>
					{#if editing === chore.id}
						<ChoreForm
							{chore}
							members={data.members}
							onsave={(c) => send(`/api/chores/${chore.id}`, 'PATCH', c)}
							oncancel={close}
						/>
					{:else}
						<div class="flex flex-wrap items-center gap-6">
							<span class="text-headline" aria-hidden="true">{chore.icon ?? '⭐'}</span>
							<div class="flex-1">
								<p class="text-title font-extrabold">{chore.title}</p>
								<p class="text-caption text-ink-muted">{describe(chore)}</p>
							</div>
							<div class="flex gap-2">
								{#each people(chore) as m (m.id)}
									<MemberAvatar name={m.name} color={m.color} avatar={m.avatar} size="sm" />
								{/each}
							</div>
							{#if archiving === chore.id}
								<div class="flex flex-col gap-3">
									<p class="text-caption">Archive {chore.title}?</p>
									{#if error}<p role="alert" class="text-caption font-bold text-danger">
											{error}
										</p>{/if}
									<div class="flex flex-wrap gap-3">
										<Button
											variant="danger"
											onclick={async () =>
												(error = await send(`/api/chores/${chore.id}/archive`, 'POST'))}
											>Yes, archive</Button
										>
										<Button variant="secondary" onclick={close}>Keep</Button>
									</div>
								</div>
							{:else}
								<div class="flex flex-wrap gap-3">
									<Button
										variant="secondary"
										aria-label="Edit {chore.title}"
										onclick={() => ((editing = chore.id), (archiving = null))}>Edit</Button
									>
									<Button
										variant="ghost"
										aria-label="Archive {chore.title}"
										onclick={() => ((archiving = chore.id), (editing = null))}>Archive</Button
									>
								</div>
							{/if}
						</div>
					{/if}
				</Card>
			</li>
		{:else}
			<li class="text-body text-ink-muted">{empty}</li>
		{/each}
	</ul>
</section>
