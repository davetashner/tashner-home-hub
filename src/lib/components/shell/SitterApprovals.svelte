<script lang="ts">
	import PinPad, { type PinResult } from '#lib/components/PinPad.svelte';
	import { toBody } from '#lib/components/kid/portal.js';
	import type { PendingItem } from '#lib/domain/approvals.js';
	import { sitter } from './sitter-state.svelte.js';

	/**
	 * Star Jobs waiting for a grown-up, checked by the sitter (hub-7pj.2). Only offered when the
	 * parents allowed it for this session. The sitter PIN is asked once, then kept in memory.
	 */
	let { onclose }: { onclose: () => void } = $props();

	let items = $state<PendingItem[]>([]);
	let loaded = $state(false);
	let message = $state('');

	async function call(
		pin: string,
		body: Record<string, unknown>
	): Promise<{ ok: boolean; data: unknown; retryAfterMs?: number }> {
		const res = await fetch('/api/sitter/approvals', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ pin, ...body })
		});
		const data = await res.json().catch(() => ({}));
		return { ok: res.ok, data, retryAfterMs: (data as { retryAfterMs?: number }).retryAfterMs };
	}

	async function load(pin: string): Promise<PinResult> {
		const r = await call(pin, { action: 'list' });
		if (!r.ok) {
			return {
				ok: false,
				message: (r.data as { message?: string }).message ?? 'Wrong PIN.',
				retryAfterMs: r.retryAfterMs
			};
		}
		sitter.pin = pin;
		items = r.data as PendingItem[];
		loaded = true;
		return { ok: true };
	}

	$effect(() => {
		// A PIN entered earlier this session: go straight to the list.
		if (sitter.pin && !loaded) void load(sitter.pin);
	});

	async function decide(item: PendingItem, action: 'approve' | 'reject') {
		const pin = sitter.pin;
		if (!pin) return;
		// Optimistic: the row leaves at once and comes back if the hub says no.
		const before = items;
		items = items.filter((i) => i.completionId !== item.completionId);
		message = '';
		const r = await call(pin, { action, completionId: item.completionId }).catch(() => null);
		if (!r?.ok) {
			items = before;
			message = 'That did not save. Try again.';
		}
	}
</script>

<div
	use:toBody
	role="dialog"
	aria-modal="true"
	aria-label="Check Star Jobs"
	data-testid="sitter-approvals"
	class="fixed inset-0 z-40 flex flex-col gap-6 overflow-y-auto bg-surface p-8 portrait:p-6 short:gap-3 short:p-3"
>
	<header class="flex items-center justify-between gap-6">
		<h2 class="text-title leading-none font-extrabold">Check Star Jobs</h2>
		<button
			type="button"
			onclick={onclose}
			data-testid="sitter-approvals-close"
			class="min-h-tap-kid min-w-tap-kid rounded-card bg-surface-raised px-8 text-lead font-bold shadow-raised active:scale-95"
		>
			Close
		</button>
	</header>

	{#if !loaded}
		<section
			class="flex flex-col items-center gap-4 rounded-card bg-surface-raised p-6 shadow-raised"
		>
			<h3 class="text-lead font-extrabold">Enter the sitter PIN</h3>
			<PinPad onsubmit={load} minLength={4} maxLength={4} />
		</section>
	{:else if items.length === 0}
		<p class="text-lead text-ink-muted" data-testid="sitter-approvals-empty">
			Nothing is waiting. Nice work, everyone!
		</p>
	{:else}
		<ul class="flex flex-col gap-4">
			{#each items as item (item.completionId)}
				<li
					data-testid="sitter-approval"
					class="flex flex-wrap items-center gap-4 rounded-card border-4 border-job-line bg-surface-raised p-4"
				>
					<span class="text-headline leading-none" aria-hidden="true">{item.choreIcon ?? '⭐'}</span
					>
					<div class="min-w-0 grow">
						<p class="text-lead font-extrabold break-words">{item.choreTitle}</p>
						<p class="text-body text-ink-muted">{item.memberName} · {item.stars} ⭐</p>
					</div>
					<button
						type="button"
						onclick={() => decide(item, 'reject')}
						class="min-h-tap-kid min-w-tap-kid rounded-card border-2 border-line bg-surface-raised px-6 text-body font-extrabold active:scale-95"
					>
						Not yet
					</button>
					<button
						type="button"
						onclick={() => decide(item, 'approve')}
						data-testid="sitter-approve"
						class="min-h-tap-kid min-w-tap-kid rounded-card bg-success px-6 text-body font-extrabold text-on-accent shadow-raised active:scale-95"
					>
						Approve
					</button>
				</li>
			{/each}
		</ul>
	{/if}
	{#if message}
		<p role="alert" class="text-body font-bold text-danger">{message}</p>
	{/if}
</div>
