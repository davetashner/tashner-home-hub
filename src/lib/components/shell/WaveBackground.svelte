<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import {
		autoPalette,
		canvasSize,
		fadeProgress,
		mixPalette,
		parseLocation,
		PICK_FADE_MS,
		SUN_FADE_MS,
		dueForFrame,
		isStarved,
		PALETTE_LOOK,
		PALETTE_SLOTS,
		parseColor,
		readDeviceWaveOff,
		waveHeld,
		waveProfile,
		resolvePalette,
		tokenName,
		WAVE_SPEED,
		WAVE_START_TIME,
		type PaletteValues,
		type WavePalette
	} from '#lib/domain/wave-background.js';
	import { createWaveRenderer, type WaveRenderer } from './wave-gl.js';
	import { powerState } from '#lib/display/power-state.svelte.js';
	import { device, wave } from './wave-state.svelte.js';

	/** Behind everything: a live WebGL wave sheet background (hub-gj6.17), with a token gradient as the fallback. */

	let canvas = $state<HTMLCanvasElement>();
	let failed = $state(false);
	let drawn = $state(false);
	let theme = $state<'light' | 'night'>('light');
	let hidden = $state(false);
	let reduced = $state(false);

	// The photo frame covers the whole screen: draw nothing (and hold no GL context) behind it.
	const covered = $derived(page.state.frame === true || page.url.pathname === '/photos');
	// Auto follows the sunset (hub-gj6.19). Re-evaluated once a minute, never per frame.
	let now = $state(Date.now());
	const location = $derived(parseLocation(page.data.waveLocation));
	const zone = $derived(typeof page.data.timeZone === 'string' ? page.data.timeZone : undefined);
	const palette = $derived(
		covered ? null : resolvePalette(wave.choice, theme, autoPalette(theme, now, location, zone))
	);
	const wall = $derived(page.data.displayRole === 'wall');
	const profile = $derived(waveProfile(wall));
	// Wall power state only matters on the wall: personal devices never run the power poller.
	const paused = $derived(
		waveHeld(profile, {
			hidden,
			reduced: false,
			powerOff: powerState.power === 'off',
			nightMode: powerState.mode !== 'normal'
		})
	);

	function localStorageOrUndefined(): Storage | undefined {
		try {
			return localStorage;
		} catch {
			return undefined;
		}
	}

	function readPalette(name: WavePalette): PaletteValues | null {
		const style = getComputedStyle(document.documentElement);
		const colors = PALETTE_SLOTS.map((slot) =>
			parseColor(style.getPropertyValue(tokenName(name, slot)))
		);
		if (colors.some((c) => c === null)) return null;
		return { colors: colors as PaletteValues['colors'], look: PALETTE_LOOK[name] };
	}

	onMount(() => {
		device.off = readDeviceWaveOff(localStorageOrUndefined());
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
		const minute = setInterval(() => (now = Date.now()), 60_000);
		return () => {
			clearInterval(minute);
			observer.disconnect();
			motion.removeEventListener('change', onMotion);
			document.removeEventListener('visibilitychange', onVisible);
		};
	});

	// The palette's colours, read from the tokens whenever the palette changes. A change crossfades
	// the colour uniforms (a minute for the sun, a moment for a pick) and never cuts hard.
	let current: PaletteValues | null = null;
	let target: PaletteValues | null = null;
	let fadeFrom: PaletteValues | null = null;
	let fadeStart = 0;
	let fadeMs = 0;

	$effect(() => {
		const next = palette ? readPalette(palette) : null;
		fadeFrom = current && next ? current : null;
		fadeStart = performance.now();
		fadeMs = wave.choice === 'auto' ? SUN_FADE_MS : PICK_FADE_MS;
		target = next;
		if (!fadeFrom) current = next;
	});

	function step(at: number) {
		if (!fadeFrom || !target) return;
		const k = fadeProgress(at, fadeStart, fadeMs);
		current = k >= 1 ? target : mixPalette(fadeFrom, target, k);
		if (k >= 1) fadeFrom = null;
	}

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
		const s = canvasSize(innerWidth, innerHeight, devicePixelRatio, profile.scale, profile.dprCap);
		renderer?.resize(s.width, s.height);
	};

	function paint(at = performance.now()) {
		step(at);
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
			if (still) paint(Infinity);
		};
		addEventListener('resize', onResize);
		let raf = 0;
		if (still) {
			paint(Infinity); // no loop to run a fade: show the new palette at once
		} else {
			let last = performance.now();
			let lastDraw = 0;
			const began = last;
			let draws = 0;
			const frame = (at: number) => {
				raf = requestAnimationFrame(frame);
				t += Math.min((at - last) / 1000, 0.1) * WAVE_SPEED;
				last = at;
				if (!dueForFrame(at, lastDraw, profile.fps)) return;
				lastDraw = at;
				paint();
				// Too slow to be worth it (no real GPU): give up and keep the still gradient.
				if (isStarved(at - began, ++draws)) failed = true;
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

{#if palette}
	<div
		class="wave-bg"
		style:background={gradient}
		aria-hidden="true"
		data-testid="wave-background"
		data-palette={palette}
		data-device={device.off ? 'off' : 'show'}
	>
		{#if !failed && !device.off}
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
