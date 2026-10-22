<!--
	Space Junk (hub-26w.2): draws a level and lets a finger or mouse pull the slingshot. It owns
	the simulation and the animation loop; the page around it (hub-26w.3) builds the HUD from
	`onchange` and `onevent`. Call `restart()` to replay the level.
-->
<script lang="ts">
	import type { Level, Point } from '#lib/domain/space-junk/level.js';
	import type { Phase, SimEvent, SpaceJunkSim } from '#lib/domain/space-junk/sim.js';
	import {
		canGrab,
		fitCamera,
		pullFromPointer,
		releasePull,
		renderSize,
		toScreen,
		type Camera
	} from '#lib/domain/space-junk/view.js';
	import {
		burst,
		DEBRIS,
		drawScene,
		makeStars,
		readPalette,
		stepParticles,
		type Particle
	} from './draw.js';

	export interface GameState {
		phase: Phase;
		junkbotsLeft: number;
		gremlinsLeft: number;
		score: number;
		stars: number;
	}

	interface Props {
		level: Level;
		/** Every sim event (launch, break, pop, end), in order. */
		onevent?: (e: SimEvent) => void;
		/** Called whenever the phase, Junkbots, Gremlins or score change, and once at the start. */
		onchange?: (s: GameState) => void;
	}
	let { level, onevent, onchange }: Props = $props();

	let canvas: HTMLCanvasElement;
	let round = $state(0);
	let phase = $state<Phase>('aiming');
	let junkbots = $state(0);

	/** Starts the level again. */
	export function restart() {
		round++;
	}

	// The physics engine is a big chunk, so it loads here rather than in the page's first paint.
	type Engine = typeof import('#lib/domain/space-junk/sim.js');
	// planck is requested on its own so it lands in its own chunk, apart from the sim code.
	const engine = Promise.all([import('planck'), import('#lib/domain/space-junk/sim.js')]).then(
		([, sim]) => sim
	);

	$effect(() => {
		void round;
		let cleanup = () => {};
		let gone = false;
		const lv = level;
		void engine.then((m) => {
			if (!gone) cleanup = run(m, lv, new m.SpaceJunkSim(lv));
		});
		return () => {
			gone = true;
			cleanup();
		};
	});

	function run(m: Engine, lv: Level, sim: SpaceJunkSim): () => void {
		const ctx = canvas.getContext('2d');
		if (!ctx) return () => {};
		const pal = readPalette(canvas);
		const stars = makeStars();
		const particles: Particle[] = [];
		let cam: Camera = fitCamera(lv, 1, 1);
		let cssW = 1;
		let cssH = 1;
		let ratio = 1;
		let pull: Point | null = null;
		let pointer: number | null = null;
		let raf = 0;
		let last = 0;
		let seen = '';

		function resize() {
			const r = canvas.getBoundingClientRect();
			cssW = r.width;
			cssH = r.height;
			const s = renderSize(cssW, cssH, window.devicePixelRatio || 1);
			canvas.width = s.width;
			canvas.height = s.height;
			ratio = s.width / Math.max(1, cssW);
			cam = fitCamera(lv, cssW, cssH);
			const a = toScreen(cam, lv.anchor);
			canvas.dataset.anchorX = String(Math.round(a.x));
			canvas.dataset.anchorY = String(Math.round(a.y));
		}

		function publish() {
			const key = `${sim.phase}|${sim.junkbotsLeft}|${sim.gremlinsLeft}|${sim.score}`;
			if (key === seen) return;
			seen = key;
			phase = sim.phase;
			junkbots = sim.junkbotsLeft;
			onchange?.({
				phase: sim.phase,
				junkbotsLeft: sim.junkbotsLeft,
				gremlinsLeft: sim.gremlinsLeft,
				score: sim.score,
				stars: sim.stars()
			});
		}

		function frame(now: number) {
			const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
			last = now;
			sim.advance(dt);
			for (const e of sim.drainEvents()) {
				if (e.type === 'break') particles.push(...burst(e, DEBRIS[e.material], 8, 0.12));
				else if (e.type === 'pop') particles.push(...burst(e, 'gremlin-body', 14, 0.16));
				onevent?.(e);
			}
			if (sim.phase !== 'aiming') pull = null;
			stepParticles(particles, dt);
			publish();
			ctx!.setTransform(ratio, 0, 0, ratio, 0, 0);
			drawScene({
				ctx: ctx!,
				cam,
				w: cssW,
				h: cssH,
				pal,
				sim,
				pull,
				path: pull ? m.trajectory(lv.anchor, pull, 24, 0.1) : [],
				particles,
				stars
			});
			raf = requestAnimationFrame(frame);
		}

		function start() {
			if (raf) return;
			last = 0;
			raf = requestAnimationFrame(frame);
		}
		function stop() {
			cancelAnimationFrame(raf);
			raf = 0;
		}
		function visibility() {
			if (document.hidden) stop();
			else start();
		}

		function at(e: PointerEvent): Point {
			const r = canvas.getBoundingClientRect();
			return { x: e.clientX - r.left, y: e.clientY - r.top };
		}
		function down(e: PointerEvent) {
			if (pointer !== null || sim.phase !== 'aiming' || sim.junkbotsLeft < 1) return;
			if (!canGrab(cam, lv.anchor, at(e))) return;
			pointer = e.pointerId;
			canvas.setPointerCapture(e.pointerId);
			pull = pullFromPointer(cam, lv.anchor, at(e));
			e.preventDefault();
		}
		function move(e: PointerEvent) {
			if (e.pointerId === pointer) pull = pullFromPointer(cam, lv.anchor, at(e));
		}
		function up(e: PointerEvent) {
			if (e.pointerId !== pointer) return;
			pointer = null;
			const shot = pull && releasePull(pull);
			pull = null;
			if (shot && e.type === 'pointerup') sim.launch(shot);
		}

		resize();
		publish();
		const ro = new ResizeObserver(resize);
		ro.observe(canvas);
		canvas.addEventListener('pointerdown', down);
		canvas.addEventListener('pointermove', move);
		canvas.addEventListener('pointerup', up);
		canvas.addEventListener('pointercancel', up);
		document.addEventListener('visibilitychange', visibility);
		visibility();
		return () => {
			stop();
			ro.disconnect();
			canvas.removeEventListener('pointerdown', down);
			canvas.removeEventListener('pointermove', move);
			canvas.removeEventListener('pointerup', up);
			canvas.removeEventListener('pointercancel', up);
			document.removeEventListener('visibilitychange', visibility);
		};
	}
</script>

<canvas
	bind:this={canvas}
	class="block h-full w-full touch-none select-none"
	data-testid="space-junk-canvas"
	data-phase={phase}
	data-junkbots={junkbots}
	aria-label={`Space Junk: ${level.name}`}
></canvas>
