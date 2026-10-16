import { loadSoundSettings, warmAudio, playDing, playFanfare, playTap } from './sound.js';

/** Chore celebrations (hub-sps.4): transform/opacity only, started in the tap's frame. */
export interface CelebrateDetail {
	choreId: string;
	memberId: string;
	stars: number;
	/** The tapped card, for the star's starting position. */
	origin: HTMLElement | null;
	/** The star jar element (bound from StarJar), for the star's landing position. */
	jar: HTMLElement | null;
}

const FLIGHT_MS = 820;
const STAGGER_MS = 120;
const SIZE = 56; // px, matches the jar's size-14 stars

import type confettiFn from 'canvas-confetti';

type Confetti = typeof confettiFn;
let confettiLoad: Promise<Confetti> | null = null;
let fire: ReturnType<Confetti['create']> | null = null;

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Fetch sound settings now and the confetti chunk once the page is idle. */
export function preloadCelebrations(): void {
	void loadSoundSettings();
	const idle = window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 500));
	// Everything heavy happens here, off the tap: audio graph, confetti worker + canvas.
	idle(() => {
		warmAudio();
		starSvg();
		void loadConfetti()
			.then((c) => {
				ensureFire(c);
			})
			.catch(() => {});
	});
}

function loadConfetti(): Promise<Confetti> {
	return (confettiLoad ??= import('canvas-confetti').then((m) => m.default));
}

function ensureFire(confetti: Confetti) {
	if (!fire) {
		// One shared full-viewport canvas drawn by a worker: confetti never touches the main thread.
		const canvas = document.createElement('canvas');
		canvas.setAttribute('aria-hidden', 'true');
		canvas.dataset.testid = 'confetti';
		canvas.style.cssText =
			'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:40';
		document.body.append(canvas);
		fire = confetti.create(canvas, {
			resize: true,
			useWorker: true,
			disableForReducedMotion: true
		});
	}
	return fire;
}

async function pop(options: Parameters<Confetti>[0]): Promise<void> {
	const fire = ensureFire(await loadConfetti());
	void fire({ ticks: 160, disableForReducedMotion: true, ...options });
}

const center = (r: DOMRect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

let template: SVGSVGElement | undefined;

function starSvg(): SVGSVGElement {
	if (template) return template.cloneNode(true) as SVGSVGElement;
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', '0 0 24 24');
	svg.setAttribute('aria-hidden', 'true');
	svg.dataset.testid = 'flying-star';
	svg.style.cssText = `position:fixed;left:0;top:0;width:${SIZE}px;height:${SIZE}px;pointer-events:none;z-index:50;will-change:transform,opacity;fill:var(--color-star);stroke:var(--color-star);stroke-width:1.6;stroke-linejoin:round`;
	const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
	path.setAttribute(
		'd',
		'M12 2.8l2.9 6 6.6.9-4.8 4.6 1.2 6.6L12 17.7l-5.9 3.2 1.2-6.6L2.5 9.7l6.6-.9z'
	);
	svg.append(path);
	template = svg;
	return svg.cloneNode(true) as SVGSVGElement;
}

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** Frames along a quadratic arc (peaking above the straight line), time-warped for an ease-in-out feel. */
function arc(from: { x: number; y: number }, to: { x: number; y: number }, lift: number) {
	const cx = (from.x + to.x) / 2 + (to.x - from.x) * 0.1;
	const cy = Math.min(from.y, to.y) - lift;
	const half = SIZE / 2;
	return Array.from({ length: 13 }, (_, i) => {
		const p = i / 12;
		const t = ease(p);
		const u = 1 - t;
		const x = u * u * from.x + 2 * u * t * cx + t * t * to.x - half;
		const y = u * u * from.y + 2 * u * t * cy + t * t * to.y - half;
		const scale = 0.7 + 0.9 * Math.sin(Math.PI * Math.min(1, p * 1.15)) + (p === 1 ? -0.6 : 0);
		return {
			transform: `translate(${x}px, ${y}px) rotate(${p * 300}deg) scale(${Math.max(0.5, scale)})`,
			opacity: p < 0.08 ? p / 0.08 : 1,
			offset: p
		};
	});
}

function slots(jar: HTMLElement, kind: 'outline' | 'gold', n: number): SVGElement[] {
	return [...jar.querySelectorAll<SVGElement>(`[data-star="${kind}"]`)].slice(-n);
}

/** Called synchronously from the tap handler, right after the optimistic update. */
export function celebrate(detail: CelebrateDetail): void {
	const { origin, jar, stars } = detail;
	const t0 = performance.now();
	playTap(stars);
	const from = origin ? center(origin.getBoundingClientRect()) : null; // before Svelte re-renders
	const motion = !reduced();
	if (motion && from) {
		void pop({
			particleCount: 28 + stars * 6,
			spread: 70,
			startVelocity: 32,
			scalar: 0.9,
			origin: { x: from.x / innerWidth, y: from.y / innerHeight }
		});
	}
	// The pending slot is rendered in a microtask (after Svelte flushes); this runs right after it.
	const syncMs = performance.now() - t0;
	queueMicrotask(() => {
		const t1 = performance.now();
		const t2 = performance.now();
		const targets = jar ? slots(jar, 'outline', stars) : [];
		targets.forEach((slot, i) => {
			if (!motion || !from) {
				slot.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: 'ease-out' });
				return;
			}
			const r = slot.getBoundingClientRect();
			const to = center(r);
			const delay = i * STAGGER_MS;
			const flyer = starSvg();
			document.body.append(flyer);
			const anim = flyer.animate(arc(from, to, 140 + Math.abs(to.x - from.x) * 0.1), {
				duration: FLIGHT_MS,
				delay,
				easing: 'linear',
				fill: 'both'
			});
			anim.onfinish = () => flyer.remove();
			// The real pending star stays hidden until the flying one lands, then pops in.
			const total = delay + FLIGHT_MS + 300;
			const land = (delay + FLIGHT_MS) / total;
			slot.animate(
				[
					{ opacity: 0, transform: 'scale(1)', offset: 0 },
					{ opacity: 0, transform: 'scale(0.6)', offset: land },
					{ opacity: 1, transform: 'scale(1.35)', offset: land + 120 / total },
					{ opacity: 1, transform: 'scale(1)', offset: 1 }
				],
				{ duration: total, easing: 'ease-out' }
			);
		});
		performance.measure('celebrate:flyers', { start: t2 }); // includes the forced layout
		// User Timing: our own scripting only (the Svelte flush between the two parts is not ours).
		performance.measure('celebrate', { start: t0, duration: syncMs + (performance.now() - t1) });
	});
}

/** The kid's pending star turned gold (a grown-up approved): a smaller ding and a little pop. */
export function celebrateApproval(jar: HTMLElement | null, stars: number): void {
	playDing();
	if (!jar) return;
	const gold = slots(jar, 'gold', Math.max(1, stars));
	for (const star of gold) {
		star.animate(
			[
				{ transform: 'scale(0.8)', filter: 'brightness(1)' },
				{ transform: 'scale(1.6)', filter: 'brightness(1.4)', offset: 0.4 },
				{ transform: 'scale(1)', filter: 'brightness(1)' }
			],
			{ duration: reduced() ? 1 : 700, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }
		);
	}
}

/** The big one: every chore today is done. Full-screen confetti plus a fanfare. */
export function celebrateAllDone(): void {
	playFanfare();
	if (reduced()) return;
	const bursts = [
		{ at: 0, x: 0.2, y: 0.9 },
		{ at: 220, x: 0.5, y: 0.9 },
		{ at: 440, x: 0.8, y: 0.9 },
		{ at: 700, x: 0.5, y: 0.2 }
	];
	for (const { at, x, y } of bursts) {
		const up = y > 0.5;
		setTimeout(
			() =>
				void pop({
					particleCount: up ? 90 : 120,
					spread: up ? 100 : 160,
					startVelocity: up ? 55 : 25,
					origin: { x, y }
				}),
			at
		);
	}
}
