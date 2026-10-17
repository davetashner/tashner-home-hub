<script lang="ts">
	import { toBody } from './portal.js';
</script>

<div
	use:toBody
	role="status"
	data-testid="all-done"
	class="banner pointer-events-none fixed inset-x-0 top-1/3 z-50 mx-auto w-fit max-w-3xl rounded-card bg-surface-raised px-16 py-12 text-center shadow-float tablet:px-8 tablet:py-6"
>
	<p class="text-headline leading-tight font-extrabold">All done today! 🎉</p>
</div>

<style>
	.banner {
		/* --duration-slow is 1ms under reduced motion: the banner just appears. */
		animation: banner-in var(--duration-slow) var(--ease-spring) both;
	}
	@keyframes banner-in {
		from {
			opacity: 0;
			transform: scale(0.6) translateY(2rem);
		}
	}
</style>
