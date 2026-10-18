<script lang="ts">
	import { navClearance, snowsOn, spriteStyle, spritesFor } from '#lib/domain/season-sprites.js';
	import type { SeasonState } from '#lib/domain/season.js';

	/** Holiday sprites over the wave (hub-6pv.6.2): transform/opacity only, still when the wave is held. */
	let { season, still }: { season: SeasonState; still: boolean } = $props();

	// Images exist only while a season with sprites is showing: nothing loads on a plain day.
	const sprites = $derived(spritesFor(season));
	const snow = $derived(snowsOn(season));

	// Keep clear of the nav when it's a bar across the screen (hub-6pv.6.8): the phone's tab bar
	// is taller than any fixed guess, and in landscape it moves to the top.
	let clear = $state({ top: 0, bottom: 0 });
	$effect(() => {
		if (sprites.length === 0) return;
		const nav = document.querySelector('nav[aria-label="Main"]');
		const measure = () =>
			(clear = navClearance(nav?.getBoundingClientRect() ?? null, window.innerHeight));
		measure();
		const resized = new ResizeObserver(measure);
		if (nav) resized.observe(nav);
		// Hiding the bars for full-screen photos and calendar toggles `inert` on the nav.
		const toggled = new MutationObserver(measure);
		if (nav) toggled.observe(nav, { attributes: true, attributeFilter: ['inert', 'class'] });
		window.addEventListener('resize', measure);
		return () => {
			resized.disconnect();
			toggled.disconnect();
			window.removeEventListener('resize', measure);
		};
	});
</script>

{#if sprites.length > 0}
	<div
		class="layer"
		class:still
		style:top="{clear.top}px"
		style:bottom="{clear.bottom}px"
		data-testid="seasonal-layer"
		data-season={season.season}
	>
		{#if snow}
			<!-- Two sheets of flakes at different speeds; each slides down one tile and repeats. -->
			<div class="snow near" data-testid="snow"></div>
			<div class="snow far"></div>
		{/if}
		{#each sprites as s (s.id)}
			<div class="sprite {s.motion}" class:flip={s.flip} style={spriteStyle(s)} data-sprite={s.id}>
				<div class="frames" class:flicker={s.flicker}>
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
	/* Santa's team crosses in the first third of its cycle, then waits off screen. */
	.team {
		animation-name: team;
		animation-timing-function: linear;
		opacity: 0;
	}
	.glow {
		animation-name: glow;
	}
	.flicker {
		animation: flicker 2.3s ease-in-out infinite;
	}
	.snow {
		position: absolute;
		inset: -100vmin 0 0;
		/* Three flakes per tile at scattered spots and sizes, so the sheet doesn't read as a grid. */
		background-image:
			radial-gradient(
				circle,
				var(--color-snow) 0 var(--flake),
				transparent calc(var(--flake) * 1.6)
			),
			radial-gradient(
				circle,
				var(--color-snow) 0 calc(var(--flake) * 0.7),
				transparent var(--flake)
			),
			radial-gradient(
				circle,
				var(--color-snow) 0 calc(var(--flake) * 0.5),
				transparent calc(var(--flake) * 0.8)
			);
		animation: snow linear infinite;
	}
	/* Each sheet falls a whole number of tiles per loop, so it lands where it started: no seam. */
	.snow.near {
		--flake: 0.4vmin;
		--fall: 95vmin;
		background-size:
			31vmin 19vmin,
			23vmin 19vmin,
			17vmin 19vmin;
		background-position:
			3vmin 2vmin,
			14vmin 11vmin,
			8vmin 15vmin;
		animation-duration: 16s;
	}
	.snow.far {
		--flake: 0.25vmin;
		--fall: 99vmin;
		background-size:
			19vmin 11vmin,
			13vmin 11vmin,
			29vmin 11vmin;
		background-position:
			1vmin 1vmin,
			9vmin 6vmin,
			20vmin 9vmin;
		opacity: 0.6;
		animation-duration: 27s;
	}
	.still .sprite,
	.still .frames,
	.still .frames img,
	.still .snow {
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
	@keyframes team {
		0% {
			transform: translate(-6vmin, 2vh);
			opacity: 1;
		}
		15% {
			transform: translate(calc(50vw + 55vmin), -1vh);
		}
		30% {
			transform: translate(calc(100vw + 115vmin), 1vh);
			opacity: 1;
		}
		30.01%,
		100% {
			transform: translate(calc(100vw + 115vmin), 1vh);
			opacity: 0;
		}
	}
	@keyframes glow {
		0%,
		100% {
			opacity: 0.8;
			transform: translateX(0);
		}
		50% {
			opacity: 1;
			transform: translateX(0.5vmin);
		}
	}
	@keyframes flicker {
		0%,
		100% {
			filter: brightness(1);
		}
		30% {
			filter: brightness(1.08);
		}
		55% {
			filter: brightness(0.96);
		}
		80% {
			filter: brightness(1.05);
		}
	}
	@keyframes snow {
		from {
			transform: translateY(0);
		}
		to {
			transform: translateY(var(--fall));
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
		.frames,
		.frames img,
		.snow {
			animation-play-state: paused;
		}
	}
</style>
