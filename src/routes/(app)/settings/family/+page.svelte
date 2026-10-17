<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import type { MemberInput } from '#lib/server/domain/members.js';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import MemberAvatar from '#lib/components/MemberAvatar.svelte';
	import MemberForm from '#lib/components/MemberForm.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	/** 'new', a member id being edited, or null. */
	let editing = $state<string | null>(null);
	let deleting = $state<string | null>(null);

	const close = () => {
		editing = null;
		deleting = null;
	};

	let deleteError = $state<string>();

	/** Sends a JSON request, refreshes the list, and returns an error message on failure. */
	async function send(url: string, method: string, body?: MemberInput) {
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
</script>

<svelte:head><title>Family</title></svelte:head>

<section class="mx-auto flex max-w-4xl flex-col gap-6 p-6 max-sm:p-3">
	<header class="flex items-center justify-between gap-4">
		<h1 class="text-headline font-extrabold">Family</h1>
		{#if editing !== 'new'}
			<Button onclick={() => ((editing = 'new'), (deleting = null))}>Add person</Button>
		{/if}
	</header>

	{#if editing === 'new'}
		<Card elevation="float">
			<MemberForm onsave={(m) => send('/api/members', 'POST', m)} oncancel={close} />
		</Card>
	{/if}

	<ul class="flex flex-col gap-4" data-testid="member-list">
		{#each data.members as member (member.id)}
			<li>
				<Card>
					{#if editing === member.id}
						<MemberForm
							{member}
							onsave={(m) => send(`/api/members/${member.id}`, 'PATCH', m)}
							oncancel={close}
						/>
					{:else}
						<div class="flex flex-wrap items-center gap-6">
							<MemberAvatar
								name={member.name}
								color={member.color}
								avatar={member.avatar}
								size="lg"
							/>
							<div class="flex-1">
								<p class="text-title font-extrabold">{member.name}</p>
								<p class="text-caption text-ink-muted">
									{member.role === 'adult' ? 'Grown-up' : 'Kid'}
								</p>
							</div>
							{#if deleting === member.id}
								<div class="flex flex-col gap-3">
									<p class="text-caption">Delete {member.name} and all their stars?</p>
									{#if deleteError}<p role="alert" class="text-caption font-bold text-danger">
											{deleteError}
										</p>{/if}
									<div class="flex flex-wrap gap-3">
										<Button
											variant="danger"
											onclick={async () =>
												(deleteError = await send(
													`/api/members/${member.id}?confirm=true`,
													'DELETE'
												))}>Yes, delete</Button
										>
										<Button variant="secondary" onclick={close}>Keep</Button>
									</div>
								</div>
							{:else}
								<div class="flex flex-wrap gap-3">
									<Button
										variant="secondary"
										onclick={() => ((editing = member.id), (deleting = null))}>Edit</Button
									>
									<Button variant="ghost" onclick={() => ((deleting = member.id), (editing = null))}
										>Delete</Button
									>
								</div>
							{/if}
						</div>
					{/if}
				</Card>
			</li>
		{:else}
			<li class="text-lead text-ink-muted">No one here yet. Add the first person.</li>
		{/each}
	</ul>
</section>
