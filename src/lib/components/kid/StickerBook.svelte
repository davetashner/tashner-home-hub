<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import type { Sticker } from '#lib/domain/badges.js';

	let { memberId, onclose }: { memberId: string; onclose: () => void } = $props();

	let book = $state<Sticker[]>([]);
	let loaded = $state(false);
	let failed = $state(false);
	const count = $derived(book.filter((s) => s.earned).length);

	onMount(async () => {
		try {
			const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
			const res = await fetch(`/api/members/${memberId}/badges?tz=${encodeURIComponent(tz)}`);
			if (!res.ok) throw new Error(String(res.status));
			book = (await res.json()) as Sticker[];
		} catch {
			failed = true;
		} finally {
			loaded = true;
		}
	});
</script>

<div class="fixed inset-0 z-20 flex items-end justify-center bg-ink/50 p-0 sm:items-center sm:p-8">
	<div
		role="dialog"
		aria-modal="true"
		aria-label="My stickers"
		data-testid="sticker-book"
		class="sheet flex max-h-full w-full max-w-5xl flex-col gap-6 overflow-y-auto overscroll-contain rounded-t-sheet bg-surface-raised p-8 pb-safe-8 shadow-float sm:rounded-sheet"
	>
		<header class="flex items-center justify-between gap-6">
			<h2 class="text-title leading-none font-extrabold">My stickers</h2>
			<Button variant="secondary" size="kid" data-testid="stickers-close" onclick={onclose}>
				Close
			</Button>
		</header>
		{#if !loaded}
			<p class="text-lead text-ink-muted" aria-busy="true">Loading...</p>
		{:else if failed}
			<p class="text-lead text-ink-muted">Your stickers could not open. Try again soon!</p>
		{:else}
			<p class="text-lead font-extrabold text-ink-muted" data-testid="sticker-count">
				{count} of {book.length} stickers
			</p>
			<ul class="grid grid-cols-2 gap-6 landscape:grid-cols-3">
				{#each book as sticker (sticker.id)}
					<li
						data-testid="sticker"
						data-earned={sticker.earned}
						class="flex flex-col items-center gap-2 rounded-card p-6 text-center {sticker.earned
							? 'bg-star-soft'
							: 'bg-surface-sunken'}"
					>
						<span
							aria-hidden="true"
							class="text-display leading-none {sticker.earned ? '' : 'opacity-25 brightness-0'}"
							>{sticker.emoji}</span
						>
						{#if sticker.earned}
							<span class="text-lead leading-tight font-extrabold">{sticker.title}</span>
							<span class="text-body text-ink-muted">{sticker.description}</span>
						{:else}
							<span class="text-lead leading-tight font-extrabold text-ink-muted"
								>{sticker.title}</span
							>
							<span class="text-body text-ink-muted">{sticker.hint}</span>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>

<style>
	.sheet {
		animation: sheet-up var(--duration-base) var(--ease-out-soft) both;
	}
	@keyframes sheet-up {
		from {
			opacity: 0;
			transform: translateY(2rem);
		}
	}
</style>
