<script lang="ts">
	import type { RoutineIconKey } from '#lib/domain/routines.js';

	/** Built-in picture icons for routine steps: simple outlines in the current text color. */
	interface Props {
		name: string;
		class?: string;
	}
	let { name, class: className = 'size-full' }: Props = $props();

	// prettier-ignore
	const PATHS: Record<RoutineIconKey, string[]> = {
		toothbrush: ['M3 21L13 11', 'M13 11l5-5 3 3-5 5z', 'M16 4l1.5 1.5', 'M19 7l1.5 1.5'],
		shirt: ['M8 3L3 6l2 4 3-1v11h8V9l3 1 2-4-5-3a4 4 0 0 1-8 0z'],
		shoes: ['M3 18v-6l4-1 3 3 6 1a5 5 0 0 1 5 3z', 'M3 18h18', 'M7 11v3'],
		backpack: ['M8 7a4 4 0 0 1 8 0', 'M6 7h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z', 'M8 14h8'],
		bed: ['M3 19V6', 'M3 15h18v4', 'M21 15v-2a3 3 0 0 0-3-3h-7v5', 'M7 12a1.5 1.5 0 1 0 0-.01'],
		book: ['M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z', 'M4 21V5', 'M9 7h6'],
		bath: ['M3 12h18v3a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5z', 'M6 12V6a2 2 0 0 1 4 0', 'M7 21l-1 1', 'M17 21l1 1'],
		hairbrush: ['M9 3h6a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z', 'M10 6v4', 'M12 6v4', 'M14 6v4', 'M12 13v8'],
		breakfast: ['M3 11h18a9 9 0 0 1-18 0z', 'M8 7c0-1.5 1-1.5 1-3', 'M12 7c0-1.5 1-1.5 1-3', 'M16 7c0-1.5 1-1.5 1-3'],
		water: ['M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z', 'M9.5 14.5a2.5 2.5 0 0 0 2 2'],
		pajamas: ['M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z', 'M17 4v4', 'M15 6h4'],
		potty: ['M6 4h8v6', 'M4 10h16v2a6 6 0 0 1-6 6h-4a6 6 0 0 1-6-6z', 'M9 18l-1 3', 'M15 18l1 3'],
		star: ['M12 2.8l2.9 6 6.6.9-4.8 4.6 1.2 6.6L12 17.7l-5.9 3.2 1.2-6.6L2.5 9.7l6.6-.9z']
	};
	const paths = $derived(PATHS[name as RoutineIconKey] ?? PATHS.star);
</script>

<svg
	viewBox="0 0 24 24"
	class={className}
	fill="none"
	stroke="currentColor"
	stroke-width="1.6"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
	data-icon={name}
>
	{#each paths as d, i (i)}<path {d} />{/each}
</svg>
