<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import {
		canvasSize,
		dueForFrame,
		PALETTE_LOOK,
		PALETTE_SLOTS,
		parseColor,
		renderScale,
		resolvePalette,
		tokenName,
		WAVE_SPEED,
		WAVE_START_TIME,
		type PaletteValues,
		type WavePalette
	} from '#lib/domain/wave-background.js';
	import { createWaveRenderer, type WaveRenderer } from './wave-gl.js';
	import { wave } from './wave-state.svelte.js';

	/** Behind everything: a live WebGL wave sheet background (hub-gj6.17), with a token gradient as the fallback. */
	const TOUCH_REST_MS = 4_000;

	let canvas = $state<HTMLCanvasElement>();
	let failed = $state(false);
	let drawn = $state(false);
	let theme = $state<'light' | 'night'>('light');
	let hidden = $state(false);
	let reduced = $state(false);
	// A touch gets the whole GPU: the waves rest for a few seconds so taps and their animations stay smooth.
	let touched = $state(false);
	let settle: ReturnType<typeof setTimeout> | undefined;
	function onTouch() {
		touched = true;
		clearTimeout(settle);
		settle = setTimeout(() => (touched = false), TOUCH_REST_MS);
	}

	// The photo frame covers the whole screen: draw nothing (and hold no GL context) behind it.
	const covered = $derived(page.state.frame === true || page.url.pathname === '/photos');
	const palette = $derived(covered ? null : resolvePalette(wave.choice, theme));
	const paused = $derived(hidden || touched || wave.paused);
	const wall = $derived(page.data.displayRole === 'wall');

	function readPalette(name: WavePalette): PaletteValues | null {
		const style = getComputedStyle(document.documentElement);
		const colors = PALETTE_SLOTS.map((slot) =>
			parseColor(style.getPropertyValue(tokenName(name, slot)))
		);
		if (colors.some((c) => c === null)) return null;
		return { colors: colors as PaletteValues['colors'], look: PALETTE_LOOK[name] };
	}

	onMount(() => {
		const readTheme = () =>
			(theme = document.documentElement.dataset.theme === 'night' ? 'night' : 'light');
		readTheme();
		const observer = new MutationObserver(readTheme);
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['data-theme']
		});
		const motion = matchMedia('(prefers-reduced-motion: reduce)');
		const onMotion = () => (reduced = motion.matches);
		onMotion();
		motion.addEventListener('change', onMotion);
		const onVisible = () => (hidden = document.hidden);
		onVisible();
		document.addEventListener('visibilitychange', onVisible);
		return () => {
			observer.disconnect();
			motion.removeEventListener('change', onMotion);
			document.removeEventListener('visibilitychange', onVisible);
			clearTimeout(settle);
		};
	});

	// The palette's colours, read from the tokens whenever the palette changes.
	let current: PaletteValues | null = null;

	$effect(() => {
		current = palette ? readPalette(palette) : null;
	});

	let renderer = $state.raw<WaveRenderer | null>(null);
	let t = WAVE_START_TIME;

	// The GL context lives and dies with the canvas.
	$effect(() => {
		const el = canvas;
		if (!el) return;
		const r = createWaveRenderer(el);
		if (!r) {
			failed = true;
			return;
		}
		renderer = r;
		return () => {
			renderer = null;
			r.destroy();
		};
	});

	const resize = () => {
		const s = canvasSize(innerWidth, innerHeight, devicePixelRatio, renderScale(wall));
		renderer?.resize(s.width, s.height);
	};

	function paint() {
		if (!renderer || !current) return;
		renderer.draw(t, current);
		drawn = true;
	}

	// The loop: runs only while visible, awake and motion is allowed. Otherwise one still frame.
	$effect(() => {
		if (!renderer || !palette) return;
		resize();
		const still = paused || reduced;
		const onResize = () => {
			resize();
			if (still) paint();
		};
		addEventListener('resize', onResize);
		let raf = 0;
		if (still) {
			paint();
		} else {
			let last = performance.now();
			let lastDraw = 0;
			const frame = (at: number) => {
				raf = requestAnimationFrame(frame);
				t += Math.min((at - last) / 1000, 0.1) * WAVE_SPEED;
				last = at;
				if (!dueForFrame(at, lastDraw)) return;
				lastDraw = at;
				paint();
			};
			raf = requestAnimationFrame(frame);
		}
		return () => {
			cancelAnimationFrame(raf);
			removeEventListener('resize', onResize);
		};
	});

	const gradient = $derived(
		palette
			? `linear-gradient(135deg, var(${tokenName(palette, 'bg-0')}), var(${tokenName(palette, 'bg-1')}) 55%, var(${tokenName(palette, 'bg-2')}))`
			: ''
	);
</script>

<svelte:window onpointerdowncapture={onTouch} />

{#if palette}
	<div class="wave-bg" style:background={gradient} aria-hidden="true" data-testid="wave-background">
		{#if !failed}
			<canvas bind:this={canvas} data-palette={palette} data-drawn={drawn}></canvas>
		{/if}
	</div>
{/if}

<style>
	.wave-bg {
		position: fixed;
		inset: 0;
		z-index: -1;
		pointer-events: none;
	}
	canvas {
		display: block;
		width: 100%;
		height: 100%;
	}
</style>
