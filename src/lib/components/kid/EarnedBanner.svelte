<script lang="ts">
	import { toBody } from './portal.js';

	let { title, image }: { title: string; image: string | null } = $props();
</script>

<div
	use:toBody
	role="status"
	data-testid="goal-earned"
	class="banner pointer-events-none fixed inset-x-0 top-1/4 z-50 mx-auto flex w-fit max-w-3xl flex-col items-center gap-4 rounded-card bg-star-soft px-16 py-12 text-center shadow-float short:top-2 short:gap-1 short:px-6 short:py-3 tablet:px-8 tablet:py-6"
>
	<p class="text-display leading-none short:text-headline" aria-hidden="true">{image ?? '🎁'}</p>
	<p class="text-headline leading-tight font-extrabold">You earned it!</p>
	<p class="text-title leading-tight font-bold">{title}</p>
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
