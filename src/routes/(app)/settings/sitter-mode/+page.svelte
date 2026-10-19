<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import { errorMessage, safeFetch } from '#lib/domain/api-error.js';
	import {
		CHECKIN_LABELS,
		emptyCard,
		type Clinic,
		type Pet,
		type SitterCard
	} from '#lib/domain/sitter.js';
	import type { SessionLogEntry, SitterSessionView } from '#lib/server/domain/sitter.js';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let card = $state<SitterCard>(emptyCard());
	let rulesText = $state('');
	/** Pets as edited: feeding times are typed as "18:00, 07:30". */
	let petRows = $state<{ pet: Pet; times: string }[]>([]);
	let sessions = $state<SitterSessionView[]>([]);
	let log = $state<SessionLogEntry[]>([]);
	let message = $state('');
	let saved = $state(false);

	let sitterName = $state('');
	let pin = $state('');
	let startLocal = $state('');
	let endLocal = $state('');
	let approveJobs = $state(false);
	let funAllowed = $state(true);

	const openSessions = $derived(sessions.filter((s) => s.status !== 'ended'));
	const field =
		'min-h-tap w-full rounded-control border-2 border-line bg-surface px-6 text-body text-ink';
	const label = 'flex flex-col gap-2';
	const cap = 'text-caption text-ink-muted';
	const json = { 'content-type': 'application/json' };

	const when = (ms: number) =>
		new Date(ms).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });

	const clock = (ms: number) =>
		new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

	const kidName = (id: string) => data.kids.find((k) => k.id === id)?.name ?? 'Child';

	/** One row per current child, keeping what was saved; rows for removed children drop out. */
	function withKidRows(c: SitterCard): SitterCard {
		const kids = data.kids.map(
			(k) =>
				c.kids.find((r) => r.memberId === k.id) ?? {
					memberId: k.id,
					bedtime: '',
					allergies: '',
					medical: ''
				}
		);
		return { ...c, kids };
	}

	// Only the newest refresh may apply: a slow older one landing late would wipe the newer state.
	let loadSeq = 0;
	async function load() {
		const seq = ++loadSeq;
		const [c, s, l] = await Promise.all([
			fetch('/api/sitter/card'),
			fetch('/api/sitter/sessions'),
			fetch('/api/sitter/log')
		]);
		const [cj, sj, lj] = await Promise.all([
			c.ok ? c.json() : null,
			s.ok ? s.json() : null,
			l.ok ? l.json() : null
		]);
		if (seq !== loadSeq) return;
		if (cj) card = withKidRows(cj);
		if (sj) sessions = sj;
		if (lj) log = lj;
		rulesText = card.rules.join('\n');
		petRows = card.pets.map((pet) => ({ pet, times: pet.feedTimes.join(', ') }));
	}
	onMount(load);

	async function saveCard(e: SubmitEvent) {
		e.preventDefault();
		const pets = petRows.map(({ pet, times }) => ({
			...pet,
			feedTimes: times.split(/[\s,]+/).filter(Boolean)
		}));
		const body = { ...card, rules: rulesText.split('\n'), pets };
		const res = await safeFetch('/api/sitter/card', {
			method: 'PUT',
			headers: json,
			body: JSON.stringify(body)
		});
		message = res.ok ? '' : await errorMessage(res);
		saved = res.ok;
		if (res.ok) {
			card = withKidRows(await res.json());
			petRows = card.pets.map((pet) => ({ pet, times: pet.feedTimes.join(', ') }));
		}
	}

	async function start(e: SubmitEvent) {
		e.preventDefault();
		const res = await safeFetch('/api/sitter/sessions', {
			method: 'POST',
			headers: json,
			body: JSON.stringify({
				sitterName,
				pin: pin || undefined,
				startAt: startLocal ? new Date(startLocal).getTime() : undefined,
				endAt: endLocal ? new Date(endLocal).getTime() : undefined,
				approveJobs,
				funAllowed
			})
		});
		message = res.ok ? '' : await errorMessage(res);
		if (res.ok) {
			sitterName = pin = startLocal = endLocal = '';
			await load();
		}
	}

	async function patch(s: SitterSessionView, body: { end?: boolean; endAt?: number }) {
		// Optimistic: a second extend tapped before the refresh lands must build on the first.
		if (body.endAt !== undefined) {
			const next = body.endAt;
			sessions = sessions.map((x) => (x.id === s.id ? { ...x, endAt: next } : x));
		}
		const res = await safeFetch(`/api/sitter/sessions/${s.id}`, {
			method: 'PATCH',
			headers: json,
			body: JSON.stringify(body)
		});
		message = res.ok ? '' : await errorMessage(res);
		await load();
	}
</script>

<svelte:head><title>Sitter mode</title></svelte:head>

<section class="mx-auto flex w-full max-w-5xl flex-col gap-8 p-8 max-sm:p-3 short:gap-4 short:p-3">
	<header class="flex flex-col gap-2">
		<h1 class="text-headline font-extrabold">Sitter mode</h1>
		<p class="text-body text-ink-muted">
			Hand the wall to a sitter for an evening. It shows tonight's plan and the emergency info.
		</p>
	</header>

	{#if message}<p class="text-danger" role="alert">{message}</p>{/if}

	<Card elevation="float">
		<div class="flex flex-col gap-6" data-testid="sitter-session">
			<h2 class="text-title font-bold">Session</h2>
			{#each openSessions as open (open.id)}
				<div class="flex flex-col gap-4" data-testid="sitter-session-row">
					<p class="text-lead" data-testid="sitter-status">
						{open.status === 'active' ? 'Active' : 'Scheduled'}
						{open.sitterName ? `for ${open.sitterName}` : ''}: {when(open.startAt)} to {when(
							open.endAt
						)}
					</p>
					<div class="grid grid-cols-3 gap-4">
						<Button
							variant="secondary"
							data-testid="sitter-extend-30"
							onclick={() => patch(open, { endAt: open.endAt + 1_800_000 })}
						>
							+30 min
						</Button>
						<Button
							variant="secondary"
							data-testid="sitter-extend"
							onclick={() => patch(open, { endAt: open.endAt + 3_600_000 })}
						>
							+1 h
						</Button>
						<Button
							variant="danger"
							data-testid="sitter-end"
							onclick={() => patch(open, { end: true })}
						>
							{open.status === 'active' ? 'End now' : 'Cancel'}
						</Button>
					</div>
				</div>
			{/each}
			<form class="flex flex-col gap-6" onsubmit={start}>
				<div class="flex flex-wrap gap-6">
					<label class="{label} min-w-64 flex-1">
						<span class={cap}>Sitter name (optional)</span>
						<input class={field} bind:value={sitterName} maxlength="60" data-testid="sitter-name" />
					</label>
					<label class="{label} w-64 max-sm:w-full">
						<span class={cap}>4-digit PIN (optional)</span>
						<input
							class={field}
							bind:value={pin}
							inputmode="numeric"
							maxlength="4"
							pattern="[0-9]*"
							autocomplete="off"
							data-testid="sitter-pin"
						/>
					</label>
				</div>
				<div class="flex flex-wrap gap-6">
					<label class="{label} max-sm:w-full">
						<span class={cap}>Starts (blank = now)</span>
						<input
							class={field}
							type="datetime-local"
							bind:value={startLocal}
							data-testid="sitter-start"
						/>
					</label>
					<label class="{label} max-sm:w-full">
						<span class={cap}>Ends</span>
						<input
							class={field}
							type="datetime-local"
							bind:value={endLocal}
							required
							data-testid="sitter-endat"
						/>
					</label>
				</div>
				<div class="flex flex-wrap gap-6 text-body">
					<label class="flex min-h-tap items-center gap-4">
						<input
							type="checkbox"
							class="size-tap"
							bind:checked={approveJobs}
							data-testid="sitter-approve"
						/>
						Sitter may approve Star Jobs
					</label>
					<label class="flex min-h-tap items-center gap-4">
						<input
							type="checkbox"
							class="size-tap"
							bind:checked={funAllowed}
							data-testid="sitter-fun"
						/>
						Games and Music allowed
					</label>
				</div>
				<div>
					<Button type="submit" data-testid="sitter-start-btn">Start sitter session</Button>
				</div>
			</form>
		</div>
	</Card>

	<Card elevation="float">
		<div class="flex flex-col gap-4" data-testid="sitter-log">
			<h2 class="text-title font-bold">Recent sessions</h2>
			{#each log as entry (entry.id)}
				<div class="flex flex-col gap-1" data-testid="sitter-log-entry">
					<p class="text-body font-bold">
						{entry.sitterName ?? 'Sitter'}: {when(entry.startAt)} to {clock(
							entry.endedAt ?? entry.endAt
						)}
					</p>
					{#each entry.checkins as c (c.at + c.kind)}
						<p class="text-body text-ink-muted" data-testid="sitter-log-checkin">
							{clock(c.at)}
							{CHECKIN_LABELS[c.kind]}
						</p>
					{:else}
						<p class="text-body text-ink-muted">No check-ins.</p>
					{/each}
				</div>
			{:else}
				<p class="text-body text-ink-muted">No finished sessions yet.</p>
			{/each}
		</div>
	</Card>

	<Card elevation="float">
		<form class="flex flex-col gap-6" onsubmit={saveCard} data-testid="sitter-card">
			<h2 class="text-title font-bold">Info card</h2>
			<p class="text-body text-ink-muted">
				Phones, address, medical notes and the Wi-Fi password are stored encrypted.
			</p>

			<div class="flex flex-col gap-4">
				<h3 class="text-lead font-bold">Emergency contacts</h3>
				{#each card.contacts as c, i (i)}
					<div class="flex flex-wrap gap-4" data-testid="sitter-contact">
						<input
							class="{field} min-w-48 flex-1"
							placeholder="Name"
							aria-label="Contact name"
							bind:value={c.name}
						/>
						<input
							class="{field} w-64 max-sm:w-full"
							placeholder="Relation"
							aria-label="Relation"
							bind:value={c.relation}
						/>
						<input
							class="{field} w-64 max-sm:w-full"
							placeholder="Phone"
							aria-label="Phone"
							inputmode="tel"
							bind:value={c.phone}
						/>
						<Button
							variant="ghost"
							aria-label="Remove contact"
							onclick={() => card.contacts.splice(i, 1)}
						>
							Remove
						</Button>
					</div>
				{/each}
				<div>
					<Button
						variant="secondary"
						data-testid="sitter-add-contact"
						onclick={() => card.contacts.push({ name: '', relation: '', phone: '' })}
					>
						Add contact
					</Button>
				</div>
			</div>

			<label class={label}>
				<span class={cap}>Home address (for 911)</span>
				<input
					class={field}
					bind:value={card.address}
					maxlength="200"
					data-testid="sitter-address"
				/>
			</label>

			<div class="flex flex-col gap-4">
				<h3 class="text-lead font-bold">Kids</h3>
				{#each card.kids as row (row.memberId)}
					{@const name = kidName(row.memberId)}
					<div class="flex flex-col gap-4" data-testid="sitter-kid">
						<p class="text-body font-bold">{name}</p>
						<div class="flex flex-wrap gap-4">
							<label class="{label} max-sm:w-full">
								<span class={cap}>Bedtime</span>
								<input
									class={field}
									type="time"
									bind:value={row.bedtime}
									aria-label="Bedtime for {name}"
								/>
							</label>
							<label class="{label} min-w-64 flex-1">
								<span class={cap}>Allergies</span>
								<input class={field} bind:value={row.allergies} aria-label="Allergies for {name}" />
							</label>
							<label class="{label} min-w-64 flex-1">
								<span class={cap}>Medical notes</span>
								<input
									class={field}
									bind:value={row.medical}
									aria-label="Medical notes for {name}"
								/>
							</label>
						</div>
					</div>
				{/each}
				{#if card.kids.length === 0}<p class="text-body text-ink-muted">No kids added yet.</p>{/if}
			</div>

			<div class="flex flex-col gap-4">
				<h3 class="text-lead font-bold">Pets</h3>
				{#each petRows as row, i (i)}
					<div class="flex flex-col gap-4" data-testid="sitter-pet">
						<div class="flex flex-wrap gap-4">
							<input
								class="{field} min-w-48 flex-1"
								placeholder="Name"
								aria-label="Pet name"
								bind:value={row.pet.name}
							/>
							<input
								class="{field} w-64 max-sm:w-full"
								placeholder="Kind (dog, cat...)"
								aria-label="Pet kind"
								bind:value={row.pet.kind}
							/>
							<input
								class="{field} w-64 max-sm:w-full"
								placeholder="Fed at (18:00, 07:30)"
								aria-label="Feeding times for pet"
								bind:value={row.times}
							/>
							<Button variant="ghost" aria-label="Remove pet" onclick={() => petRows.splice(i, 1)}>
								Remove
							</Button>
						</div>
						<input
							class={field}
							placeholder="Feeding, medicine, quirks"
							aria-label="Pet notes"
							bind:value={row.pet.notes}
						/>
					</div>
				{/each}
				<div>
					<Button
						variant="secondary"
						data-testid="sitter-add-pet"
						onclick={() =>
							petRows.push({ pet: { name: '', kind: '', notes: '', feedTimes: [] }, times: '' })}
					>
						Add pet
					</Button>
				</div>
				{@render clinicFields('Regular vet', card.vet, 'vet')}
				{@render clinicFields('After-hours pet emergency hospital', card.petER, 'pet-er')}
			</div>

			<label class={label}>
				<span class={cap}>House rules (one per line)</span>
				<textarea class="{field} py-4" rows="4" bind:value={rulesText} data-testid="sitter-rules"
				></textarea>
			</label>

			<div class="flex flex-wrap gap-6">
				<label class="{label} min-w-64 flex-1">
					<span class={cap}>Wi-Fi name</span>
					<input
						class={field}
						bind:value={card.wifiName}
						maxlength="64"
						data-testid="sitter-wifi"
					/>
				</label>
				<label class="{label} min-w-64 flex-1">
					<span class={cap}>Wi-Fi password</span>
					<input
						class={field}
						bind:value={card.wifiPassword}
						maxlength="64"
						autocomplete="off"
						data-testid="sitter-wifipw"
					/>
				</label>
			</div>

			<label class={label}>
				<span class={cap}>Notes for tonight</span>
				<textarea
					class="{field} py-4"
					rows="3"
					bind:value={card.tonight}
					data-testid="sitter-tonight"></textarea>
			</label>

			<div class="flex items-center gap-4">
				<Button type="submit" data-testid="sitter-save">Save info card</Button>
				{#if saved}<span class="text-body text-ink-muted" role="status">Saved</span>{/if}
			</div>
		</form>
	</Card>
</section>

{#snippet clinicFields(title: string, c: Clinic, id: string)}
	<div class="flex flex-col gap-4" data-testid="sitter-{id}">
		<p class="text-body font-bold">{title}</p>
		<div class="flex flex-wrap gap-4">
			<input
				class="{field} min-w-48 flex-1"
				placeholder="Name"
				aria-label="{title} name"
				bind:value={c.name}
			/>
			<input
				class="{field} w-64 max-sm:w-full"
				placeholder="Phone"
				aria-label="{title} phone"
				inputmode="tel"
				bind:value={c.phone}
			/>
			<input
				class="{field} w-64 max-sm:w-full"
				placeholder="Hours"
				aria-label="{title} hours"
				bind:value={c.hours}
			/>
		</div>
		<input
			class={field}
			placeholder="Address"
			aria-label="{title} address"
			bind:value={c.address}
		/>
	</div>
{/snippet}
