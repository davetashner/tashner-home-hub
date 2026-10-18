<script lang="ts">
	import { onMount } from 'svelte';
	import PinPad, { type PinResult } from '#lib/components/PinPad.svelte';
	import { toBody } from '#lib/components/kid/portal.js';
	import {
		POISON_CONTROL,
		type Clinic,
		type SitterCard,
		type WallSession
	} from '#lib/domain/sitter.js';
	import { sitter, unlockCard } from './sitter-state.svelte.js';

	/**
	 * The Emergency info sheet (hub-7pj.2). The 911 strip and Poison Control are always shown, with
	 * no PIN in the way. The household card (address, contacts, allergies...) shows at once when the
	 * session has no sitter PIN, and after the PIN is entered once when it has one.
	 */
	let { onclose }: { onclose: () => void } = $props();

	let names = $state<Record<string, string>>({});
	const card = $derived<SitterCard | null>(
		sitter.cardFor === sitter.session?.id ? sitter.card : null
	);

	onMount(() => {
		fetch('/api/members')
			.then((r) => (r.ok ? r.json() : []))
			.then((list: { id: string; name: string }[]) => {
				names = Object.fromEntries(list.map((m) => [m.id, m.name]));
			})
			.catch(() => {});
		const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onclose();
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});

	async function check(pin: string): Promise<PinResult> {
		const res = await fetch('/api/sitter/check', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ pin })
		});
		const body = (await res.json().catch(() => ({}))) as {
			session?: WallSession;
			card?: SitterCard;
			message?: string;
			retryAfterMs?: number;
		};
		if (res.ok && body.session && body.card) {
			unlockCard(body.session, body.card);
			return { ok: true };
		}
		return {
			ok: false,
			message: body.message ?? 'Wrong PIN.',
			retryAfterMs: body.retryAfterMs
		};
	}

	const tel = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;
	const poisonDigits = POISON_CONTROL.replace(/\D/g, '');
</script>

<!-- tel: links are not routes -->
<!-- eslint-disable svelte/no-navigation-without-resolve -->
<div
	use:toBody
	role="dialog"
	aria-modal="true"
	aria-label="Emergency info"
	data-testid="emergency-sheet"
	class="fixed inset-0 z-40 flex flex-col gap-6 overflow-y-auto bg-surface p-8 portrait:p-6 short:gap-3 short:p-3"
>
	<header class="flex items-center justify-between gap-6">
		<h2 class="text-title leading-none font-extrabold">Emergency info</h2>
		<button
			type="button"
			onclick={onclose}
			data-testid="emergency-close"
			class="press min-h-tap-kid min-w-tap-kid rounded-card bg-surface-raised px-8 text-lead font-bold shadow-raised"
		>
			Close
		</button>
	</header>

	<section
		data-testid="emergency-911"
		class="flex flex-wrap items-center justify-between gap-x-8 gap-y-3 rounded-card bg-emergency px-8 py-6 text-on-emergency short:px-4 short:py-3"
	>
		<div>
			<p class="text-headline leading-none font-extrabold short:text-title">Call 911</p>
			<p class="mt-2 text-lead font-bold" data-testid="emergency-address">
				{#if card?.address}{card.address}{:else if sitter.session?.hasPin}Enter the sitter PIN for
					the address{:else}No address saved yet{/if}
			</p>
		</div>
		<a
			href="tel:{poisonDigits}"
			data-testid="emergency-poison"
			class="press flex min-h-tap-kid items-center rounded-card bg-on-emergency px-8 text-lead font-extrabold text-emergency"
		>
			Poison Control {POISON_CONTROL}
		</a>
	</section>

	{#if card}
		<div
			class="grid grid-cols-3 gap-6 portrait:grid-cols-1 short:grid-cols-2 short:gap-3 tablet:landscape:grid-cols-2"
			data-testid="emergency-card"
		>
			<section
				class="flex flex-col gap-3 rounded-card bg-surface-raised p-6 shadow-raised short:p-3"
			>
				<h3 class="text-lead font-extrabold">Call first</h3>
				{#each card.contacts as c, i (i)}
					<a
						href={tel(c.phone)}
						data-testid="emergency-contact"
						class="press flex min-h-tap-kid flex-col justify-center rounded-control bg-surface-sunken px-4 py-2"
					>
						<span class="text-body font-extrabold">{c.name}</span>
						<span class="text-caption text-ink-muted">{c.relation} · {c.phone}</span>
					</a>
				{:else}
					<p class="text-body text-ink-muted">No contacts saved.</p>
				{/each}
			</section>

			{#each card.kids as kid (kid.memberId)}
				<section
					data-testid="emergency-kid"
					class="flex flex-col gap-3 rounded-card bg-surface-raised p-6 shadow-raised short:p-3"
				>
					<h3 class="text-lead font-extrabold">{names[kid.memberId] ?? 'Child'}</h3>
					<dl class="flex flex-col gap-2 text-body">
						<div>
							<dt class="text-caption font-extrabold text-emergency">Allergies</dt>
							<dd>{kid.allergies || 'None listed'}</dd>
						</div>
						<div>
							<dt class="text-caption font-extrabold text-ink-muted">Medical</dt>
							<dd>{kid.medical || 'None listed'}</dd>
						</div>
						<div>
							<dt class="text-caption font-extrabold text-ink-muted">Bedtime</dt>
							<dd>{kid.bedtime || 'Not set'}</dd>
						</div>
					</dl>
				</section>
			{/each}

			{#if card.pets.length > 0 || card.vet.name || card.petER.name}
				<section
					data-testid="emergency-pets"
					class="flex flex-col gap-3 rounded-card bg-surface-raised p-6 shadow-raised short:p-3"
				>
					<h3 class="text-lead font-extrabold">Pets</h3>
					{#each card.pets as pet, i (i)}
						<div data-testid="emergency-pet" class="flex flex-col text-body">
							<p class="font-extrabold">{pet.name}{pet.kind ? ` (${pet.kind})` : ''}</p>
							{#if pet.feedTimes.length > 0}
								<p class="text-caption text-ink-muted">Fed at {pet.feedTimes.join(', ')}</p>
							{/if}
							{#if pet.notes}<p class="whitespace-pre-line">{pet.notes}</p>{/if}
						</div>
					{/each}
					{@render clinic('Vet', card.vet)}
					{@render clinic('After-hours pet ER', card.petER)}
				</section>
			{/if}

			<section
				class="flex flex-col gap-3 rounded-card bg-surface-raised p-6 shadow-raised short:p-3"
			>
				<h3 class="text-lead font-extrabold">Wi-Fi and tonight</h3>
				<dl class="flex flex-col gap-2 text-body">
					{#if card.wifiName}
						<div>
							<dt class="text-caption font-extrabold text-ink-muted">Wi-Fi</dt>
							<dd data-testid="emergency-wifi">{card.wifiName} · {card.wifiPassword}</dd>
						</div>
					{/if}
					{#if card.tonight}
						<div>
							<dt class="text-caption font-extrabold text-ink-muted">Notes for tonight</dt>
							<dd class="whitespace-pre-line" data-testid="emergency-tonight">{card.tonight}</dd>
						</div>
					{/if}
				</dl>
			</section>
		</div>
	{:else if sitter.session?.hasPin}
		<section
			data-testid="emergency-pin"
			class="flex flex-col items-center gap-4 rounded-card bg-surface-raised p-6 shadow-raised"
		>
			<h3 class="text-lead font-extrabold">Enter the sitter PIN</h3>
			<PinPad onsubmit={check} minLength={4} maxLength={4} />
		</section>
	{:else}
		<p class="text-body text-ink-muted">Loading...</p>
	{/if}
</div>

{#snippet clinic(title: string, c: Clinic)}
	{#if c.name}
		<div data-testid="emergency-clinic" class="flex flex-col text-body">
			<p class="text-caption font-extrabold text-ink-muted">{title}</p>
			<p class="font-extrabold">{c.name}</p>
			{#if c.hours}<p class="text-caption text-ink-muted">{c.hours}</p>{/if}
			{#if c.address}<p>{c.address}</p>{/if}
			{#if c.phone}
				<a
					href="tel:{c.phone.replace(/[^\d+]/g, '')}"
					class="press flex min-h-tap-kid items-center rounded-control bg-surface-sunken px-4 font-extrabold"
				>
					{c.phone}
				</a>
			{/if}
		</div>
	{/if}
{/snippet}

<!-- eslint-enable svelte/no-navigation-without-resolve -->

<style>
	.press {
		transition: transform var(--duration-quick) var(--ease-out-soft);
	}
	.press:active {
		transform: scale(0.95);
	}
</style>
