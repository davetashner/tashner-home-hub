/**
 * Space Junk (hub-26w.2): canvas drawing. All art is code, coloured from the `--color-*` tokens
 * in layout.css (read once with `readPalette`), so there are no image files and no raw colours.
 */
import type { MaterialId } from '#lib/domain/space-junk/materials.js';
import type { Point } from '#lib/domain/space-junk/level.js';
import type { BodyView, SpaceJunkSim } from '#lib/domain/space-junk/sim.js';
import { toScreen, type Camera } from '#lib/domain/space-junk/view.js';

const KEYS = [
	'space-sky',
	'space-sky-low',
	'space-star',
	'space-ground',
	'junk-scrap',
	'junk-glass',
	'junk-rock',
	'junk-edge',
	'junk-crack',
	'junkbot-body',
	'junkbot-visor',
	'gremlin-body',
	'gremlin-belly',
	'sling-wood',
	'sling-band',
	'aim-dot'
] as const;
export type Palette = Record<(typeof KEYS)[number], string>;

/** Reads the Space Junk colour tokens as computed on `el`. */
export function readPalette(el: Element): Palette {
	const style = getComputedStyle(el);
	const out = {} as Palette;
	for (const k of KEYS) out[k] = style.getPropertyValue(`--color-${k}`).trim() || 'transparent';
	return out;
}

export interface Particle {
	x: number;
	y: number;
	vx: number;
	vy: number;
	/** Seconds left. */
	life: number;
	size: number;
	color: keyof Palette;
}

const LIFE = 0.8;

/** Debris or a pop burst at a world position. */
export function burst(at: Point, color: keyof Palette, count: number, size: number): Particle[] {
	const out: Particle[] = [];
	for (let i = 0; i < count; i++) {
		const a = (i / count) * Math.PI * 2 + at.x;
		const v = 2 + ((i * 7) % 5);
		out.push({
			x: at.x,
			y: at.y,
			vx: Math.cos(a) * v,
			vy: Math.sin(a) * v + 2,
			life: LIFE,
			size,
			color
		});
	}
	return out;
}

export const DEBRIS: Record<MaterialId, keyof Palette> = {
	scrap: 'junk-scrap',
	glass: 'junk-glass',
	rock: 'junk-rock'
};

/** Moves particles on by `dt` seconds under gravity and drops the dead ones, in place. */
export function stepParticles(list: Particle[], dt: number) {
	for (const p of list) {
		p.vy -= 10 * dt;
		p.x += p.vx * dt;
		p.y += p.vy * dt;
		p.life -= dt;
	}
	let n = 0;
	for (const p of list) if (p.life > 0) list[n++] = p;
	list.length = n;
}

/** A fixed scatter of stars as fractions of the canvas. */
export function makeStars(count = 70): { x: number; y: number; r: number }[] {
	let s = 12345;
	const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
	return Array.from({ length: count }, () => ({ x: rnd(), y: rnd(), r: 0.5 + rnd() * 1.5 }));
}

export interface Scene {
	ctx: CanvasRenderingContext2D;
	cam: Camera;
	/** Canvas size in CSS pixels. */
	w: number;
	h: number;
	pal: Palette;
	sim: SpaceJunkSim;
	/** The pouch pull while the player drags, else null. */
	pull: Point | null;
	/** The dotted flight preview for `pull`, in world metres. */
	path: Point[];
	particles: Particle[];
	stars: { x: number; y: number; r: number }[];
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
	ctx.beginPath();
	ctx.arc(x, y, r, 0, Math.PI * 2);
}

function cracks(ctx: CanvasRenderingContext2D, hw: number, hh: number, health: number) {
	if (health >= 0.7) return;
	ctx.beginPath();
	ctx.moveTo(-hw * 0.6, -hh);
	ctx.lineTo(-hw * 0.1, -hh * 0.2);
	ctx.lineTo(-hw * 0.4, hh * 0.3);
	ctx.lineTo(0, hh);
	ctx.stroke();
}

function drawBlock(sc: Scene, b: BodyView) {
	const { ctx, pal, cam } = sc;
	const c = toScreen(cam, b);
	const k = cam.scale;
	ctx.save();
	ctx.translate(c.x, c.y);
	ctx.rotate(-b.angle);
	ctx.fillStyle = pal[DEBRIS[b.material ?? 'scrap']];
	ctx.strokeStyle = pal['junk-edge'];
	ctx.lineWidth = Math.max(2, k * 0.06);
	let hw = b.r * k;
	let hh = hw;
	if (b.shape === 'box') {
		hw = (b.w / 2) * k;
		hh = (b.h / 2) * k;
		ctx.fillRect(-hw, -hh, hw * 2, hh * 2);
		ctx.strokeRect(-hw, -hh, hw * 2, hh * 2);
	} else {
		circle(ctx, 0, 0, hw);
		ctx.fill();
		ctx.stroke();
	}
	if (b.material === 'glass') {
		ctx.globalAlpha = 0.5;
		ctx.fillStyle = pal['space-star'];
		ctx.fillRect(-hw * 0.8, -hh * 0.6, Math.max(2, hw * 0.4), Math.max(2, hh * 0.3));
	}
	ctx.globalAlpha = (1 - b.health) * 0.5;
	ctx.fillStyle = pal['junk-edge'];
	if (b.shape === 'box') ctx.fillRect(-hw, -hh, hw * 2, hh * 2);
	else {
		circle(ctx, 0, 0, hw);
		ctx.fill();
	}
	ctx.globalAlpha = 1;
	ctx.strokeStyle = pal['junk-crack'];
	ctx.lineWidth = Math.max(1.5, k * 0.04);
	cracks(ctx, hw, hh, b.health);
	ctx.restore();
}

function drawGremlin(sc: Scene, b: BodyView) {
	const { ctx, pal, cam } = sc;
	const c = toScreen(cam, b);
	const r = b.r * cam.scale;
	ctx.save();
	ctx.translate(c.x, c.y);
	ctx.rotate(-b.angle);
	ctx.fillStyle = pal['gremlin-body'];
	ctx.strokeStyle = pal['junk-edge'];
	ctx.lineWidth = Math.max(2, r * 0.1);
	circle(ctx, 0, 0, r);
	ctx.fill();
	ctx.stroke();
	ctx.fillStyle = pal['gremlin-belly'];
	ctx.beginPath();
	ctx.ellipse(0, r * 0.45, r * 0.55, r * 0.35, 0, 0, Math.PI * 2);
	ctx.fill();
	for (const sx of [-1, 1]) {
		ctx.fillStyle = pal['space-star'];
		circle(ctx, sx * r * 0.38, -r * 0.15, r * 0.28);
		ctx.fill();
		ctx.fillStyle = pal['junk-edge'];
		circle(ctx, sx * r * 0.38 + sx * -r * 0.04, -r * 0.1, r * 0.13);
		ctx.fill();
	}
	ctx.strokeStyle = pal['junk-edge'];
	ctx.beginPath();
	ctx.arc(0, r * 0.3, r * 0.22, 0.2, Math.PI - 0.2);
	ctx.stroke();
	ctx.restore();
}

/** A round robot at screen position `s`, radius `r` px. */
function drawBot(ctx: CanvasRenderingContext2D, pal: Palette, s: Point, r: number, angle: number) {
	ctx.save();
	ctx.translate(s.x, s.y);
	ctx.rotate(-angle);
	ctx.strokeStyle = pal['junk-edge'];
	ctx.lineWidth = Math.max(2, r * 0.12);
	ctx.beginPath();
	ctx.moveTo(0, -r);
	ctx.lineTo(0, -r * 1.45);
	ctx.stroke();
	ctx.fillStyle = pal['sling-band'];
	circle(ctx, 0, -r * 1.5, r * 0.15);
	ctx.fill();
	ctx.fillStyle = pal['junkbot-body'];
	circle(ctx, 0, 0, r);
	ctx.fill();
	ctx.stroke();
	ctx.fillStyle = pal['junkbot-visor'];
	ctx.beginPath();
	ctx.roundRect(-r * 0.7, -r * 0.4, r * 1.4, r * 0.6, r * 0.3);
	ctx.fill();
	ctx.fillStyle = pal['space-star'];
	circle(ctx, r * 0.25, -r * 0.1, r * 0.12);
	ctx.fill();
	ctx.restore();
}

function band(sc: Scene, from: Point, to: Point, width: number) {
	const { ctx, pal } = sc;
	ctx.strokeStyle = pal['sling-band'];
	ctx.lineWidth = width;
	ctx.lineCap = 'round';
	ctx.beginPath();
	ctx.moveTo(from.x, from.y);
	ctx.lineTo(to.x, to.y);
	ctx.stroke();
}

/** Draws one frame. The back band sits behind the Junkbot in the pouch, the front band over it. */
export function drawScene(sc: Scene) {
	const { ctx, cam, pal, sim, w, h } = sc;
	const k = cam.scale;
	const sky = ctx.createLinearGradient(0, 0, 0, h);
	sky.addColorStop(0, pal['space-sky']);
	sky.addColorStop(1, pal['space-sky-low']);
	ctx.fillStyle = sky;
	ctx.fillRect(0, 0, w, h);
	ctx.fillStyle = pal['space-star'];
	for (const s of sc.stars) {
		ctx.globalAlpha = 0.4 + s.r * 0.3;
		circle(ctx, s.x * w, s.y * cam.oy, s.r);
		ctx.fill();
	}
	ctx.globalAlpha = 1;

	ctx.fillStyle = pal['space-ground'];
	ctx.fillRect(0, cam.oy, w, h - cam.oy);

	// Slingshot.
	const anchor = sim.level.anchor;
	const post = toScreen(cam, { x: anchor.x, y: 0 });
	const a = toScreen(cam, anchor);
	const tineY = a.y + k * 0.1;
	const left = { x: a.x - k * 0.4, y: tineY };
	const right = { x: a.x + k * 0.4, y: tineY };
	ctx.strokeStyle = pal['sling-wood'];
	ctx.lineWidth = Math.max(5, k * 0.25);
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';
	ctx.beginPath();
	ctx.moveTo(left.x, left.y);
	ctx.lineTo(a.x, a.y + k * 0.7);
	ctx.lineTo(right.x, right.y);
	ctx.moveTo(a.x, a.y + k * 0.7);
	ctx.lineTo(post.x, post.y);
	ctx.stroke();

	const pouch = sc.pull ? toScreen(cam, { x: anchor.x + sc.pull.x, y: anchor.y + sc.pull.y }) : a;
	const bandW = Math.max(3, k * 0.12);
	band(sc, left, pouch, bandW);

	if (sc.pull) {
		ctx.fillStyle = pal['aim-dot'];
		for (const [i, p] of sc.path.entries()) {
			const s = toScreen(cam, p);
			ctx.globalAlpha = 1 - i / 28;
			circle(ctx, s.x, s.y, Math.max(2.5, k * 0.09));
			ctx.fill();
		}
		ctx.globalAlpha = 1;
	}

	for (const b of sim.bodies()) {
		if (b.kind === 'block') drawBlock(sc, b);
		else if (b.kind === 'gremlin') drawGremlin(sc, b);
		else drawBot(ctx, pal, toScreen(cam, b), b.r * k, b.angle);
	}

	if (sim.phase === 'aiming' && sim.junkbotsLeft > 0) drawBot(ctx, pal, pouch, 0.45 * k, 0);
	band(sc, right, pouch, bandW);

	for (const p of sc.particles) {
		const s = toScreen(cam, p);
		ctx.globalAlpha = Math.min(1, p.life / LIFE);
		ctx.fillStyle = pal[p.color];
		ctx.fillRect(s.x, s.y, p.size * k, p.size * k);
	}
	ctx.globalAlpha = 1;
}
