import { describe, expect, it } from 'vitest';
import { LEVELS } from './levels.js';
import { parseLevel } from './level.js';
import { SpaceJunkSim, TURN_TIMEOUT_STEPS } from './sim.js';

type Pull = { x: number; y: number };

/** A recorded winning shot list per level (found by grid search; the sim is deterministic). */
const SOLUTIONS: Record<string, Pull[]> = {
	'junk-1': [{ x: -2.5, y: -0.25 }],
	'junk-2': [{ x: -2.5, y: -0.25 }],
	'junk-3': [{ x: -2.5, y: -1 }],
	'junk-4': [{ x: -2.5, y: -1.25 }],
	'junk-5': [{ x: -2.5, y: -0.75 }],
	'junk-6': [{ x: -2.5, y: -0.5 }],
	'junk-7': [
		{ x: -2.5, y: -0.25 },
		{ x: -2, y: -0.5 }
	],
	'junk-8': [
		{ x: -2.5, y: -0.75 },
		{ x: -2.25, y: -0.5 }
	],
	'junk-9': [
		{ x: -2.5, y: -1 },
		{ x: -2.25, y: -0.75 }
	],
	'junk-10': [
		{ x: -2.5, y: -0.75 },
		{ x: -2.5, y: -0.5 }
	]
};

function play(level: (typeof LEVELS)[number], ...pulls: Pull[]) {
	const sim = new SpaceJunkSim(level);
	for (let i = 0; i < 60; i++) sim.step();
	for (const pull of pulls) {
		if (!sim.launch(pull)) break;
		for (let i = 0; sim.phase === 'flying' && i < TURN_TIMEOUT_STEPS + 1; i++) sim.step();
	}
	return sim;
}

describe('levels', () => {
	it('has ten uniquely named, valid levels', () => {
		expect(LEVELS).toHaveLength(10);
		expect(new Set(LEVELS.map((l) => l.id)).size).toBe(10);
		expect(new Set(LEVELS.map((l) => l.name)).size).toBe(10);
		for (const l of LEVELS) {
			const parsed = parseLevel(JSON.parse(JSON.stringify(l)));
			expect(parsed.ok, l.id).toBe(true);
		}
	});

	for (const level of LEVELS) {
		describe(level.id + ' ' + level.name, () => {
			it('settles without moving or breaking anything', () => {
				const sim = new SpaceJunkSim(level);
				const start = sim.bodies();
				for (let i = 0; i < 600; i++) sim.step();
				expect(sim.drainEvents()).toEqual([]);
				expect(sim.phase).toBe('aiming');
				expect(sim.gremlinsLeft).toBe(level.gremlins.length);
				const end = sim.bodies();
				expect(end).toHaveLength(start.length);
				start.forEach((b, i) => {
					expect(Math.hypot(b.x - end[i]!.x, b.y - end[i]!.y), `body ${i}`).toBeLessThan(0.1);
				});
			});

			it('keeps the slingshot area clear', () => {
				for (const b of level.blocks) expect(b.x).toBeGreaterThan(level.anchor.x + 8);
			});

			it('can be won with a recorded shot list', () => {
				const shots = SOLUTIONS[level.id]!;
				expect(shots.length).toBeLessThanOrEqual(level.junkbots);
				const sim = play(level, ...shots);
				expect(sim.phase).toBe('won');
				expect(sim.stars()).toBeGreaterThanOrEqual(level.junkbots - shots.length >= 2 ? 3 : 2);
			});
		});
	}

	it('forgives wide aim on the first level', () => {
		let wins = 0;
		for (let x = -2.5; x <= -1.5; x += 0.25) {
			for (let y = -0.5; y <= 0.25; y += 0.25) {
				if (play(LEVELS[0]!, { x, y }).phase === 'won') wins++;
			}
		}
		expect(wins).toBeGreaterThanOrEqual(12);
	});
});
