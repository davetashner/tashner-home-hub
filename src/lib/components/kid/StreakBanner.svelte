<script lang="ts">
	import { toBody } from './portal.js';

	let { days, stars }: { days: number; stars: number } = $props();
</script>

<div
	use:toBody
	role="status"
	data-testid="streak-milestone"
	class="banner pointer-events-none fixed inset-x-0 top-1/4 z-50 mx-auto flex w-fit max-w-3xl flex-col items-center gap-4 rounded-card bg-star-soft px-16 py-12 text-center shadow-float short:top-2 short:gap-1 short:px-6 short:py-3"
>
	<p class="text-display leading-none short:text-headline" aria-hidden="true">🔥</p>
	<p class="text-headline leading-tight font-extrabold">{days} days in a row!</p>
	<p class="text-title leading-tight font-bold">+{stars} bonus stars</p>
</div>

<style>
	.banner {
		animation: banner-in var(--duration-slow) var(--ease-spring) both;
	}
	@keyframes banner-in {
		from {
			opacity: 0;
			transform: scale(0.6) translateY(2rem);
		}
	}
</style>
