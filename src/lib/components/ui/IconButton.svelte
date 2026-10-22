<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	interface Props extends HTMLButtonAttributes {
		/** Required: icon-only buttons need an accessible name. */
		label: string;
		size?: 'md' | 'kid';
		children: Snippet;
	}

	let { label, size = 'md', type = 'button', children, ...rest }: Props = $props();
</script>

<button
	{type}
	aria-label={label}
	class="press inline-flex items-center justify-center rounded-chip border-2 border-control-line bg-control text-ink shadow-raised {size ===
	'kid'
		? 'size-tap-kid text-title'
		: 'size-tap text-lead'}"
	{...rest}
>
	{@render children()}
</button>

<style>
	.press {
		transition: transform var(--duration-quick) var(--ease-out-soft);
		cursor: pointer;
	}
	.press:active:not(:disabled) {
		transform: scale(0.9);
		transition-duration: var(--duration-instant);
	}
	.press:focus-visible {
		outline: 4px solid var(--color-accent);
		outline-offset: 4px;
	}
</style>
