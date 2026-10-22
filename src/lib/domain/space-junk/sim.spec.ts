import { describe, expect, it } from 'vitest';
import type { Level } from './level.js';
import { TEST_TOWER } from './fixtures.js';
import { UNUSED_JUNKBOT_POINTS } from './materials.js';
import {
	MAX_PULL,
	SpaceJunkSim,
	STEP,
	TURN_TIMEOUT_STEPS,
	clampPull,
	launchVelocity,
	trajectory
} from './sim.js';

const WINNING_PULL = { x: -2, y: 0 };
const WEAK_PULL = { x: -0.4, y: -0.4 };

function play(level: Level, ...pulls: { x: number; y: number }[]) {
	const sim = new SpaceJunkSim(level);
	for (let i = 0; i < 60; i++) sim.step();
	for (const pull of pulls) {
		expect(sim.launch(pull)).toBe(true);
		for (let i = 0; sim.phase === 'flying' && i < TURN_TIMEOUT_STEPS + 1; i++) sim.step();
	}
	return sim;
}

describe('launch math', () => {
	it('clamps the pull and fires the other way', () => {
		expect(clampPull({ x: -1, y: 0 })).toEqual({ x: -1, y: 0 });
		const far = clampPull({ x: -30, y: -40 });
		expect(Math.hypot(far.x, far.y)).toBeCloseTo(MAX_PULL);
		const v = launchVelocity({ x: -1, y: -1 });
		expect(v.x).toBeGreaterThan(0);
		expect(v.y).toBeGreaterThan(0);
	});

	it('previews a falling arc from the pouch', () => {
		const pts = trajectory({ x: 4, y: 3 }, { x: -2, y: -1 }, 20);
		expect(pts).toHaveLength(20);
		expect(pts[0]!.x).toBeGreaterThan(2);
		expect(pts.at(-1)!.y).toBeLessThan(pts[5]!.y);
	});
});

describe('SpaceJunkSim', () => {
	it('lets a level settle without anything breaking', () => {
		const sim = new SpaceJunkSim(TEST_TOWER);
		for (let i = 0; i < 600; i++) sim.step();
		expect(sim.phase).toBe('aiming');
		expect(sim.gremlinsLeft).toBe(1);
		expect(sim.bodies().every((b) => b.health === 1)).toBe(true);
		expect(sim.drainEvents()).toEqual([]);
	});

	it('wins with a good shot and scores the spare Junkbots', () => {
		const sim = play(TEST_TOWER, WINNING_PULL);
		expect(sim.phase).toBe('won');
		expect(sim.gremlinsLeft).toBe(0);
		expect(sim.junkbotsLeft).toBe(2);
		expect(sim.stars()).toBe(3);
		expect(sim.score).toBeGreaterThanOrEqual(1000 + 2 * UNUSED_JUNKBOT_POINTS);
		const events = sim.drainEvents();
		expect(events[0]).toMatchObject({ type: 'launch' });
		expect(events.filter((e) => e.type === 'pop')).toHaveLength(1);
		expect(events.at(-1)).toEqual({ type: 'end', phase: 'won' });
		expect(sim.bodies().some((b) => b.kind === 'junkbot')).toBe(false);
		expect(sim.launch(WINNING_PULL)).toBe(false);
		const steps = sim.steps;
		sim.step();
		expect(sim.steps).toBe(steps);
	});

	it('is deterministic', () => {
		const a = play(TEST_TOWER, WEAK_PULL, WINNING_PULL);
		const b = play(TEST_TOWER, WEAK_PULL, WINNING_PULL);
		expect(b.score).toBe(a.score);
		expect(b.steps).toBe(a.steps);
		expect(b.bodies()).toEqual(a.bodies());
	});

	it('goes back to aiming after a miss and loses when out of Junkbots', () => {
		const sim = play({ ...TEST_TOWER, junkbots: 2 }, WEAK_PULL);
		expect(sim.phase).toBe('aiming');
		expect(sim.junkbotsLeft).toBe(1);
		expect(sim.stars()).toBe(0);
		expect(play({ ...TEST_TOWER, junkbots: 2 }, WEAK_PULL, WEAK_PULL).phase).toBe('lost');
	});

	it('ignores a pull too short to count and shots while flying', () => {
		const sim = new SpaceJunkSim(TEST_TOWER);
		expect(sim.launch({ x: -0.1, y: 0 })).toBe(false);
		expect(sim.launch(WINNING_PULL)).toBe(true);
		expect(sim.launch(WINNING_PULL)).toBe(false);
		expect(sim.bodies().find((b) => b.kind === 'junkbot')?.health).toBe(1);
	});

	it('breaks blocks and removes anything that falls off the world', () => {
		const level: Level = {
			...TEST_TOWER,
			blocks: [
				{ material: 'glass', shape: 'box', x: 10, y: 8, w: 1, h: 1, angle: 0.3 },
				{ material: 'rock', shape: 'ball', x: 25, y: 0.5, r: 0.5 }
			],
			gremlins: [{ x: 15, y: 0.5, r: 0.5 }]
		};
		const sim = new SpaceJunkSim(level);
		for (let i = 0; i < 300; i++) sim.step();
		const broke = sim.drainEvents();
		expect(broke).toEqual([expect.objectContaining({ type: 'break', material: 'glass' })]);
		expect(sim.bodies().map((b) => b.material)).toEqual(['rock', null]);
	});

	it('counts a Gremlin pushed off the edge as popped', () => {
		const level: Level = {
			...TEST_TOWER,
			width: 10,
			gremlins: [{ x: 9.5, y: 0.5, r: 0.5 }],
			blocks: []
		};
		const sim = play(level, { x: -2.5, y: 0.6 });
		expect(sim.gremlinsLeft).toBe(0);
		expect(sim.phase).toBe('won');
	});

	it('ends a turn on the timeout even if something keeps moving', () => {
		// A ball on flat ground has no rolling resistance, so this Junkbot never comes to rest.
		const level: Level = {
			...TEST_TOWER,
			width: 80,
			blocks: [],
			gremlins: [{ x: 79, y: 0.5, r: 0.5 }]
		};
		const sim = new SpaceJunkSim(level);
		sim.launch({ x: -0.6, y: 0 });
		const start = sim.steps;
		while (sim.phase === 'flying' && sim.steps < start + TURN_TIMEOUT_STEPS + 10) sim.step();
		expect(sim.phase).toBe('aiming');
		expect(sim.steps - start).toBe(TURN_TIMEOUT_STEPS);
	});

	it('advances in fixed steps and drops a long stall', () => {
		const sim = new SpaceJunkSim(TEST_TOWER);
		sim.advance(STEP * 2.5);
		expect(sim.steps).toBe(2);
		sim.advance(STEP * 0.6);
		expect(sim.steps).toBe(3);
		sim.advance(10);
		expect(sim.steps).toBe(8);
		sim.advance(-1);
		expect(sim.steps).toBe(8);
	});
});
