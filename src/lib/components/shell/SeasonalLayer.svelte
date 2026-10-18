<script lang="ts">
	import { spriteStyle, spritesFor } from '#lib/domain/season-sprites.js';
	import type { SeasonState } from '#lib/domain/season.js';

	/** Holiday sprites over the wave (hub-6pv.6.2): transform/opacity only, still when the wave is held. */
	let { season, still }: { season: SeasonState; still: boolean } = $props();

	// Images exist only while a season with sprites is showing: nothing loads on a plain day.
	const sprites = $derived(spritesFor(season));
</script>

{#if sprites.length > 0}
	<div class="layer" class:still data-testid="seasonal-layer" data-season={season.season}>
		{#each sprites as s (s.id)}
			<div class="sprite {s.motion}" class:flip={s.flip} style={spriteStyle(s)} data-sprite={s.id}>
				<div class="frames">
					<img src={s.src} alt="" decoding="async" draggable="false" />
					{#if s.flap}
						<img class="flap" src={s.flap} alt="" decoding="async" draggable="false" />
					{/if}
				</div>
			</div>
		{/each}
	</div>
{/if}

<style>
	.layer {
		position: absolute;
		inset: 0;
		overflow: hidden;
		pointer-events: none;
	}
	.sprite {
		position: absolute;
		animation-duration: var(--period);
		animation-delay: var(--delay);
		animation-iteration-count: infinite;
		animation-timing-function: ease-in-out;
	}
	.frames {
		position: relative;
		height: 100%;
	}
	.frames img {
		display: block;
		height: 100%;
		width: auto;
	}
	.flip .frames {
		transform: scaleX(-1);
	}
	.flap {
		position: absolute;
		inset: 0;
		opacity: 0;
		animation: flap 0.9s steps(1, end) infinite;
	}
	.frames img:first-child {
		animation: flap-base 0.9s steps(1, end) infinite;
	}
	.frames img:only-child {
		animation: none;
	}

	/* Pumpkins: a tiny sway, so nothing sits in one exact spot for hours (burn-in). */
	.rest {
		animation-name: rest;
		transform-origin: 50% 100%;
	}
	/* Portrait puts the nav along the bottom: the pumpkins sit just above it. */
	@media (orientation: portrait) {
		.rest {
			margin-bottom: 9vh;
		}
	}
	.float {
		animation-name: float;
	}
	/* Bats cross the top in the first part of the cycle, then wait off screen. */
	.fly {
		animation-name: fly;
		animation-timing-function: linear;
		transform: translateX(-30vw);
	}
	.fly.flip {
		animation-direction: reverse;
	}
	.still .sprite,
	.still .frames img {
		animation-play-state: paused;
	}

	@keyframes rest {
		0%,
		100% {
			transform: translateX(0) rotate(0deg);
		}
		50% {
			transform: translateX(0.6vmin) rotate(1.5deg);
		}
	}
	@keyframes float {
		0%,
		100% {
			transform: translateY(0);
		}
		50% {
			transform: translateY(-3vmin);
		}
	}
	@keyframes fly {
		0% {
			transform: translate(-30vw, 0);
			opacity: 1;
		}
		20% {
			transform: translate(45vw, 3vh);
		}
		40% {
			transform: translate(130vw, -2vh);
			opacity: 1;
		}
		40.01%,
		100% {
			transform: translate(130vw, -2vh);
			opacity: 0;
		}
	}
	@keyframes flap {
		0%,
		49.99% {
			opacity: 0;
		}
		50%,
		100% {
			opacity: 1;
		}
	}
	@keyframes flap-base {
		0%,
		49.99% {
			opacity: 1;
		}
		50%,
		100% {
			opacity: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.sprite,
		.frames img {
			animation-play-state: paused;
		}
	}
</style>
