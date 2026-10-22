/**
 * Space Junk (hub-26w.1): one level being played. Wraps a planck.js world with a fixed 1/60 s
 * step so the same level and the same launches always play out the same way (tests rely on it).
 *
 * Damage: when two bodies first touch, both take the impact energy 0.5 * mu * vn^2 (mu is the
 * reduced mass, vn the approach speed at the contact). Bodies resting on each other start
 * touching with vn ~ 0, so tall towers stand without wearing down. Nothing is hurt during the
 * first moments while a level settles.
 *
 * Turns: `aiming` -> `launch()` -> `flying` until everything is still (or a timeout), then the
 * next Junkbot, `won` (no Gremlins left) or `lost` (no Junkbots left).
 */
import { Box, Circle, World, type Body, type Contact } from 'planck';
import type { Level, Point } from './level.js';
import {
	GREMLIN,
	JUNKBOT,
	MATERIALS,
	UNUSED_JUNKBOT_POINTS,
	type MaterialId
} from './materials.js';
import { MAX_PULL, MIN_PULL, clampPull } from './pull.js';
import { starsFor, type Stars } from './score.js';

export { MAX_PULL, MIN_PULL, clampPull };

export const STEP = 1 / 60;
export const GRAVITY = -10;
/** Launch speed per metre of pull. */
export const LAUNCH_POWER = 9;
/** Approach speeds below this (m/s) do no damage. */
export const MIN_IMPACT_SPEED = 1;
/** Steps after a level loads during which nothing takes damage. */
export const GRACE_STEPS = 30;
/** Consecutive still steps that end a turn. */
export const REST_STEPS = 30;
const REST_SPEED = 0.05;
/** A turn ends after this many steps however much is still moving. */
export const TURN_TIMEOUT_STEPS = 15 * 60;
/** Once the last Gremlin pops, the turn ends this soon. */
export const WIN_WAIT_STEPS = 3 * 60;
/** How far past the level's edges a body may go before it is gone. */
const OUT_MARGIN = 10;
/** Most steps `advance` runs per call, so a stalled tab does not spiral. */
const MAX_STEPS_PER_ADVANCE = 5;

export type Phase = 'aiming' | 'flying' | 'won' | 'lost';
export type BodyKind = 'block' | 'gremlin' | 'junkbot';

export interface BodyView {
	id: number;
	kind: BodyKind;
	material: MaterialId | null;
	shape: 'box' | 'ball';
	/** Full width and height for boxes, 0 for balls. */
	w: number;
	h: number;
	/** Radius for balls, 0 for boxes. */
	r: number;
	x: number;
	y: number;
	angle: number;
	/** 1 when new, falling to 0 as it takes damage. */
	health: number;
}

export type SimEvent =
	| { type: 'launch'; x: number; y: number }
	| { type: 'break'; x: number; y: number; material: MaterialId }
	| { type: 'pop'; x: number; y: number }
	| { type: 'end'; phase: Phase };

interface Tag {
	id: number;
	kind: BodyKind;
	material: MaterialId | null;
	shape: 'box' | 'ball';
	w: number;
	h: number;
	r: number;
	hp: number;
	damage: number;
	points: number;
}

const tagOf = (b: Body) => b.getUserData() as Tag | null;
const ball = (kind: BodyKind, r: number, hp: number, points: number) =>
	({ kind, material: null, shape: 'ball', w: 0, h: 0, r, hp, points }) as const;

/** The launch velocity for a pull: opposite the pull, faster the further back. */
export function launchVelocity(pull: Point): Point {
	const p = clampPull(pull);
	return { x: -p.x * LAUNCH_POWER, y: -p.y * LAUNCH_POWER };
}

/** Points along the no-collision flight path of a launch from `anchor`, `dt` seconds apart. */
export function trajectory(anchor: Point, pull: Point, count = 30, dt = 0.08): Point[] {
	const p = clampPull(pull);
	const v = launchVelocity(pull);
	const out: Point[] = [];
	for (let i = 1; i <= count; i++) {
		const t = i * dt;
		out.push({ x: anchor.x + p.x + v.x * t, y: anchor.y + p.y + v.y * t + 0.5 * GRAVITY * t * t });
	}
	return out;
}

export class SpaceJunkSim {
	readonly level: Level;
	phase: Phase = 'aiming';
	junkbotsLeft: number;
	gremlinsLeft: number;
	score = 0;
	steps = 0;

	private world = new World({ x: 0, y: GRAVITY });
	private nextId = 1;
	private events: SimEvent[] = [];
	private doomed = new Set<Body>();
	private junkbot: Body | null = null;
	private turnSteps = 0;
	private stillSteps = 0;
	private wonAt: number | null = null;
	private carry = 0;

	constructor(level: Level) {
		this.level = level;
		this.junkbotsLeft = level.junkbots;
		this.gremlinsLeft = level.gremlins.length;
		const ground = this.world.createBody();
		ground.createFixture(
			new Box(level.width / 2 + OUT_MARGIN, 0.5, { x: level.width / 2, y: -0.5 }, 0),
			{
				friction: 0.8
			}
		);
		for (const b of level.blocks) {
			const m = MATERIALS[b.material];
			const body = this.world.createBody({
				type: 'dynamic',
				position: { x: b.x, y: b.y },
				angle: b.shape === 'box' ? b.angle : 0
			});
			body.createFixture(b.shape === 'box' ? new Box(b.w / 2, b.h / 2) : new Circle(b.r), m);
			this.tag(body, {
				kind: 'block',
				material: b.material,
				shape: b.shape,
				w: b.shape === 'box' ? b.w : 0,
				h: b.shape === 'box' ? b.h : 0,
				r: b.shape === 'ball' ? b.r : 0,
				hp: m.hp,
				points: m.points
			});
		}
		for (const g of level.gremlins) {
			const body = this.world.createBody({ type: 'dynamic', position: { x: g.x, y: g.y } });
			body.createFixture(new Circle(g.r), GREMLIN);
			this.tag(body, ball('gremlin', g.r, GREMLIN.hp, GREMLIN.points));
		}
		this.world.on('begin-contact', (c) => this.impact(c));
	}

	private tag(body: Body, t: Omit<Tag, 'id' | 'damage'>) {
		body.setUserData({ ...t, id: this.nextId++, damage: 0 });
	}

	private impact(c: Contact) {
		if (this.steps < GRACE_STEPS) return;
		const a = c.getFixtureA().getBody();
		const b = c.getFixtureB().getBody();
		const wm = c.getWorldManifold(null);
		const p = wm?.points[0];
		if (!wm || !p) return;
		const va = a.getLinearVelocityFromWorldPoint(p);
		const vb = b.getLinearVelocityFromWorldPoint(p);
		const vn = -((vb.x - va.x) * wm.normal.x + (vb.y - va.y) * wm.normal.y);
		if (vn < MIN_IMPACT_SPEED) return;
		const ma = a.getMass();
		const mb = b.getMass();
		const mu = ma === 0 ? mb : mb === 0 ? ma : (ma * mb) / (ma + mb);
		const energy = 0.5 * mu * vn * vn;
		for (const body of [a, b]) {
			const t = tagOf(body);
			if (!t || t.kind === 'junkbot') continue;
			t.damage += energy;
			if (t.damage >= t.hp) this.doomed.add(body);
		}
	}

	/** Fires a Junkbot. `pull` is the pouch position minus the anchor. False if not allowed now. */
	launch(pull: Point): boolean {
		if (this.phase !== 'aiming' || Math.hypot(pull.x, pull.y) < MIN_PULL) return false;
		const p = clampPull(pull);
		const at = { x: this.level.anchor.x + p.x, y: this.level.anchor.y + p.y };
		const body = this.world.createBody({ type: 'dynamic', position: at, bullet: true });
		body.createFixture(new Circle(JUNKBOT.radius), JUNKBOT);
		body.setLinearVelocity(launchVelocity(pull));
		this.tag(body, ball('junkbot', JUNKBOT.radius, Infinity, 0));
		this.junkbot = body;
		this.junkbotsLeft--;
		this.phase = 'flying';
		this.turnSteps = 0;
		this.stillSteps = 0;
		this.events.push({ type: 'launch', x: at.x, y: at.y });
		return true;
	}

	/** Runs one fixed step. */
	step() {
		if (this.phase === 'won' || this.phase === 'lost') return;
		this.world.step(STEP, 8, 3);
		this.steps++;
		this.sweep();
		if (this.phase === 'flying') this.endTurnIfDone();
	}

	/** Runs as many fixed steps as `seconds` of real time covers (capped), keeping the remainder. */
	advance(seconds: number) {
		this.carry = Math.min(this.carry + Math.max(0, seconds), STEP * MAX_STEPS_PER_ADVANCE);
		while (this.carry >= STEP) {
			this.carry -= STEP;
			this.step();
		}
	}

	private out(body: Body) {
		const { x, y } = body.getPosition();
		return x < -OUT_MARGIN || x > this.level.width + OUT_MARGIN || y < -OUT_MARGIN;
	}

	private sweep() {
		for (let b = this.world.getBodyList(); b; b = b.getNext()) {
			const t = tagOf(b);
			if (t && t.kind !== 'junkbot' && this.out(b)) this.doomed.add(b);
		}
		for (const body of this.doomed) {
			const t = tagOf(body)!;
			const { x, y } = body.getPosition();
			this.score += t.points;
			if (t.kind === 'gremlin') {
				this.gremlinsLeft--;
				this.events.push({ type: 'pop', x, y });
				if (this.gremlinsLeft === 0) this.wonAt = this.steps;
			} else {
				this.events.push({ type: 'break', x, y, material: t.material! });
			}
			this.world.destroyBody(body);
		}
		this.doomed.clear();
	}

	private still() {
		for (let b = this.world.getBodyList(); b; b = b.getNext()) {
			if (!b.isDynamic() || !b.isAwake()) continue;
			if (
				b.getLinearVelocity().length() > REST_SPEED ||
				Math.abs(b.getAngularVelocity()) > REST_SPEED
			)
				return false;
		}
		return true;
	}

	private endTurnIfDone() {
		this.turnSteps++;
		this.stillSteps = this.still() ? this.stillSteps + 1 : 0;
		const junkbotGone = this.junkbot !== null && this.out(this.junkbot);
		const winWaitOver = this.wonAt !== null && this.steps - this.wonAt >= WIN_WAIT_STEPS;
		if (
			this.stillSteps < REST_STEPS &&
			this.turnSteps < TURN_TIMEOUT_STEPS &&
			!winWaitOver &&
			!junkbotGone
		)
			return;
		if (this.junkbot) this.world.destroyBody(this.junkbot);
		this.junkbot = null;
		if (this.gremlinsLeft === 0) {
			this.phase = 'won';
			this.score += this.junkbotsLeft * UNUSED_JUNKBOT_POINTS;
		} else {
			this.phase = this.junkbotsLeft > 0 ? 'aiming' : 'lost';
		}
		if (this.phase !== 'aiming') this.events.push({ type: 'end', phase: this.phase });
	}

	/** In-game stars: 0 until won. */
	stars(): Stars {
		return starsFor(this.phase === 'won', this.junkbotsLeft);
	}

	/** Everything to draw this frame. */
	bodies(): BodyView[] {
		const out: BodyView[] = [];
		for (let b = this.world.getBodyList(); b; b = b.getNext()) {
			const t = tagOf(b);
			if (!t) continue;
			const { x, y } = b.getPosition();
			const health = t.hp === Infinity ? 1 : Math.max(0, 1 - t.damage / t.hp);
			out.push({
				id: t.id,
				kind: t.kind,
				material: t.material,
				shape: t.shape,
				w: t.w,
				h: t.h,
				r: t.r,
				x,
				y,
				angle: b.getAngle(),
				health
			});
		}
		return out.sort((p, q) => p.id - q.id);
	}

	/** Events since the last call, oldest first (for sounds and effects). */
	drainEvents(): SimEvent[] {
		const out = this.events;
		this.events = [];
		return out;
	}
}
