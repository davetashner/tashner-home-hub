<script lang="ts">
	/**
	 * One star. gold = earned, outline = waiting for a grown-up, empty = still to fill.
	 * job / job-outline are the pink Star Job checkbox (done / waiting) on the To-Dos board.
	 */
	let {
		variant = 'gold',
		class: className = 'size-12'
	}: { variant?: 'gold' | 'outline' | 'empty' | 'job' | 'job-outline'; class?: string } = $props();

	const looks = {
		gold: 'fill-star stroke-star',
		outline: 'fill-star-soft stroke-ink-muted [stroke-dasharray:3_2.5]',
		empty: 'fill-transparent stroke-line',
		job: 'fill-job stroke-job',
		'job-outline': 'fill-transparent stroke-job [stroke-dasharray:3_2.5]'
	};
</script>

<svg
	viewBox="0 0 24 24"
	aria-hidden="true"
	data-star={variant}
	class="shrink-0 {looks[variant]} {className}"
	stroke-width="1.6"
	stroke-linejoin="round"
	stroke-linecap="round"
>
	<path d="M12 2.8l2.9 6 6.6.9-4.8 4.6 1.2 6.6L12 17.7l-5.9 3.2 1.2-6.6L2.5 9.7l6.6-.9z" />
</svg>
