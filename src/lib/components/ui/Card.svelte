<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	interface Props extends HTMLAttributes<HTMLDivElement> {
		/** `float` lifts the card higher, for overlays and focus. */
		elevation?: 'raised' | 'float' | 'flat';
		children: Snippet;
	}

	let { elevation = 'raised', children, class: className = '', ...rest }: Props = $props();

	const shadows = { flat: 'border-2 border-line', raised: 'shadow-raised', float: 'shadow-float' };
</script>

<div
	class="rounded-card bg-surface-raised p-8 max-sm:p-4 short:p-4 {shadows[elevation]} {className}"
	{...rest}
>
	{@render children()}
</div>
