<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { requestLock } from '#lib/client/lock.js';
	import Icon from './Icon.svelte';
	import { showToast } from './toast.svelte.js';

	/** `chip`: icon-only square for the shell header. `row`: labelled button for the settings page. */
	let { variant = 'chip' }: { variant?: 'chip' | 'row' } = $props();

	let busy = $state(false);

	async function lock() {
		if (busy) return;
		busy = true;
		const ok = await requestLock();
		busy = false;
		if (!ok) {
			showToast('Could not lock. Try again.');
			return;
		}
		await goto(resolve('/(app)'), { invalidateAll: true });
		await invalidateAll();
		showToast('Locked');
	}
</script>

<button
	type="button"
	onclick={lock}
	disabled={busy}
	aria-label="Lock"
	data-testid={variant === 'chip' ? 'lock-chip' : 'lock-row'}
	class="press inline-flex items-center justify-center gap-2 rounded-chip border-2 border-line bg-surface-raised text-ink shadow-raised {variant ===
	'chip'
		? 'size-tap-kid text-title max-sm:size-tap'
		: 'min-h-tap px-6 text-body font-bold'}"
>
	<Icon name="lock" />
	{#if variant === 'row'}<span>Lock</span>{/if}
</button>

<style>
	.press {
		transition: transform var(--duration-quick) var(--ease-out-soft);
		cursor: pointer;
	}
	.press:active:not(:disabled) {
		transform: scale(0.92);
		transition-duration: var(--duration-instant);
	}
	.press:focus-visible {
		outline: 4px solid var(--color-accent);
		outline-offset: 4px;
	}
</style>
