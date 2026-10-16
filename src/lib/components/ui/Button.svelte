<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
	type Size = 'md' | 'kid';

	interface Props extends HTMLButtonAttributes {
		variant?: Variant;
		size?: Size;
		children: Snippet;
	}

	let {
		variant = 'primary',
		size = 'md',
		type = 'button',
		class: className = '',
		children,
		...rest
	}: Props = $props();

	const variants: Record<Variant, string> = {
		primary: 'bg-accent text-on-accent shadow-raised',
		secondary: 'bg-surface-raised text-ink border-2 border-line shadow-raised',
		ghost: 'bg-transparent text-accent',
		danger: 'bg-danger text-on-accent shadow-raised'
	};
	const sizes: Record<Size, string> = {
		md: 'min-h-tap min-w-tap px-8 text-body',
		kid: 'min-h-tap-kid min-w-tap-kid px-12 text-title rounded-card'
	};
</script>

<button
	{type}
	class="press inline-flex items-center justify-center gap-3 rounded-control font-extrabold {variants[
		variant
	]} {sizes[size]} {className}"
	{...rest}
>
	{@render children()}
</button>

<style>
	/* Press feedback lands on :active in the same frame; only transform/opacity animate. */
	.press {
		transition:
			transform var(--duration-quick) var(--ease-out-soft),
			opacity var(--duration-quick) linear;
		cursor: pointer;
	}
	.press:active:not(:disabled) {
		transform: scale(0.95);
		transition-duration: var(--duration-instant);
	}
	.press:focus-visible {
		outline: 4px solid var(--color-accent);
		outline-offset: 4px;
	}
	.press:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
</style>
