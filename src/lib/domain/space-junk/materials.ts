/**
 * Space Junk (hub-26w.1): what the station towers are made of. Damage is impact energy in
 * joules (see `sim.ts`), so `hp` reads as "how hard a hit it takes to break".
 */
export type MaterialId = 'scrap' | 'glass' | 'rock';

export interface Material {
	/** kg per square metre (the world is 2D). */
	density: number;
	friction: number;
	restitution: number;
	hp: number;
	/** Points for breaking one. */
	points: number;
}

export const MATERIALS: Record<MaterialId, Material> = {
	scrap: { density: 1, friction: 0.6, restitution: 0.1, hp: 40, points: 200 },
	glass: { density: 0.8, friction: 0.3, restitution: 0.05, hp: 12, points: 100 },
	rock: { density: 2.5, friction: 0.8, restitution: 0.02, hp: 200, points: 300 }
};

export const JUNKBOT = { radius: 0.45, density: 3, friction: 0.5, restitution: 0.3 } as const;
export const GREMLIN = {
	density: 0.6,
	friction: 0.5,
	restitution: 0.2,
	hp: 5,
	points: 1000
} as const;
/** Points per Junkbot not needed to win. */
export const UNUSED_JUNKBOT_POINTS = 2000;
