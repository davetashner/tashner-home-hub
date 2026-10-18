/**
 * Seasonal sprites over the wave background (hub-6pv.6.2): which pictures a season shows and how
 * each one moves. Data only: the layer turns each entry into an image with a CSS animation.
 * The July 4th entries come later.
 */
import type { WaveChoice } from './wave-background.js';
import { REINDEER, type Season, type SeasonState } from './season.js';

/**
 * How a sprite moves. Every motion is transform/opacity only and never rests in one exact spot
 * for hours (burn-in): `rest` sways a little, `float` bobs, `fly` crosses the screen now and then,
 * `team` crosses as one line with the rest of its team (Santa's sleigh), `glow` breathes softly.
 */
export type SpriteMotion = 'rest' | 'float' | 'fly' | 'team' | 'glow';

export interface Sprite {
	id: string;
	/** Image under /static. */
	src: string;
	/** A second frame crossfaded with the first (a bat's wing flap). */
	flap?: string;
	motion: SpriteMotion;
	/** Height as a share of the screen's shorter side (vmin), so both orientations fit. */
	size: number;
	/**
	 * Anchor: distance from one horizontal edge in vmin (so a cluster keeps its spacing in both
	 * orientations) and from one vertical edge in % of the screen. Resting sprites stay on the
	 * right: the nav rail covers the left edge in landscape.
	 */
	x: { edge: 'left' | 'right'; vmin: number };
	y: { edge: 'top' | 'bottom'; pct: number };
	/** One full cycle of the motion, in seconds. */
	period: number;
	/** Where in its cycle the sprite starts, in seconds (spreads sprites out). */
	delay: number;
	/** Faces left: flipped horizontally (a bat flying right to left). */
	flip?: boolean;
	/** Flickers in brightness (filter only), like firelight. */
	flicker?: boolean;
}

const HALLOWEEN = '/seasons/halloween';

/** Halloween: pumpkins in the bottom corners, bats crossing the top now and then, a bobbing ghost. */
const halloween: Sprite[] = [
	{
		id: 'jack-tall',
		src: `${HALLOWEEN}/jack-tall.webp`,
		motion: 'rest',
		size: 12,
		x: { edge: 'right', vmin: 2 },
		y: { edge: 'bottom', pct: 0.5 },
		period: 300,
		delay: 0
	},
	{
		id: 'pumpkin',
		src: `${HALLOWEEN}/pumpkin.webp`,
		motion: 'rest',
		size: 7,
		x: { edge: 'right', vmin: 26 },
		y: { edge: 'bottom', pct: 0.5 },
		period: 360,
		delay: -120
	},
	{
		id: 'jack-round',
		src: `${HALLOWEEN}/jack-round.webp`,
		motion: 'rest',
		size: 10,
		x: { edge: 'right', vmin: 14 },
		y: { edge: 'bottom', pct: 0.5 },
		period: 330,
		delay: -200
	},
	{
		id: 'ghost',
		src: `${HALLOWEEN}/ghost.webp`,
		motion: 'float',
		size: 11,
		x: { edge: 'right', vmin: 3 },
		y: { edge: 'top', pct: 34 },
		period: 9,
		delay: 0
	},
	{
		id: 'bat-1',
		src: `${HALLOWEEN}/bat-glide.webp`,
		flap: `${HALLOWEEN}/bat-flap.webp`,
		motion: 'fly',
		size: 8,
		x: { edge: 'left', vmin: 0 },
		y: { edge: 'top', pct: 9 },
		period: 70,
		delay: -4
	},
	{
		id: 'bat-2',
		src: `${HALLOWEEN}/bat-glide.webp`,
		flap: `${HALLOWEEN}/bat-flap.webp`,
		motion: 'fly',
		size: 6,
		x: { edge: 'left', vmin: 0 },
		y: { edge: 'top', pct: 18 },
		period: 95,
		delay: -50,
		flip: true
	}
];

const CHRISTMAS = '/seasons/christmas';

/** Grazing, standing and resting poses in turn, so the herd doesn't look stamped out. */
const POSES = ['graze', 'stand', 'lie', 'stand', 'graze', 'lie', 'graze', 'stand'] as const;
const POSE_SIZE = { stand: 10, graze: 9, lie: 8 } as const;

/**
 * The countdown herd (hub-6pv.6.3): one reindeer joins each day from Dec 16, lining up from the
 * right corner toward the middle. Rudolph comes last.
 */
function herd(count: number): Sprite[] {
	return REINDEER.slice(0, count).map((name, i) => {
		const pose = name === 'Rudolph' ? 'stand' : POSES[i % POSES.length]!;
		return {
			id: `reindeer-${name.toLowerCase()}`,
			src: `${CHRISTMAS}/${name === 'Rudolph' ? 'rudolph' : 'reindeer'}-${pose}.webp`,
			motion: 'rest',
			size: POSE_SIZE[pose],
			x: { edge: 'right', vmin: 2 + i * 10.5 },
			y: { edge: 'bottom', pct: 0.5 },
			period: 280 + i * 23,
			delay: -i * 41,
			flip: i % 3 === 1
		};
	});
}

/**
 * Christmas Eve (hub-6pv.6.4): pines along the bottom right and, every few minutes, Santa's sleigh
 * pulled across the sky by all nine, Rudolph in front. Every member of the team shares one
 * period and delay, so the line moves as one; the snow is drawn by the layer itself.
 */
const SLEIGH_PERIOD = 200;
const TEAM_GAP = 9;
const eve: Sprite[] = [
	{
		id: 'pine-tall',
		src: `${CHRISTMAS}/pine-tall.webp`,
		motion: 'rest',
		size: 22,
		x: { edge: 'right', vmin: 1 },
		y: { edge: 'bottom', pct: 0 },
		period: 340,
		delay: 0
	},
	{
		id: 'pine-short',
		src: `${CHRISTMAS}/pine-short.webp`,
		motion: 'rest',
		size: 15,
		x: { edge: 'right', vmin: 14 },
		y: { edge: 'bottom', pct: 0 },
		period: 290,
		delay: -90
	},
	{
		id: 'pine-far',
		src: `${CHRISTMAS}/pine-tall.webp`,
		motion: 'rest',
		size: 12,
		x: { edge: 'right', vmin: 24 },
		y: { edge: 'bottom', pct: 0 },
		period: 380,
		delay: -200
	},
	{
		id: 'sleigh',
		src: `${CHRISTMAS}/sleigh.webp`,
		motion: 'team',
		size: 9,
		x: { edge: 'left', vmin: -(REINDEER.length * TEAM_GAP + 17) },
		y: { edge: 'top', pct: 10 },
		period: SLEIGH_PERIOD,
		delay: -6
	},
	...REINDEER.map((name, i): Sprite => ({
		id: `team-${name.toLowerCase()}`,
		src: `${CHRISTMAS}/${name === 'Rudolph' ? 'rudolph' : 'reindeer'}-fly.webp`,
		motion: 'team',
		size: 7,
		x: { edge: 'left', vmin: -(REINDEER.length - i) * TEAM_GAP },
		y: { edge: 'top', pct: 9 },
		period: SLEIGH_PERIOD,
		delay: -6
	}))
];

const CHRISTMASDAY = '/seasons/christmasday';

/** Christmas Day (hub-6pv.6.6): the tree and its presents by a crackling fire. No people. */
const christmasday: Sprite[] = [
	{
		id: 'fireplace',
		src: `${CHRISTMASDAY}/fireplace.webp`,
		motion: 'rest',
		size: 18,
		x: { edge: 'right', vmin: 19 },
		y: { edge: 'bottom', pct: 0.5 },
		period: 420,
		delay: -150,
		flicker: true
	},
	{
		id: 'tree',
		src: `${CHRISTMASDAY}/tree.webp`,
		motion: 'rest',
		size: 26,
		x: { edge: 'right', vmin: 2 },
		y: { edge: 'bottom', pct: 0.5 },
		period: 360,
		delay: 0
	}
];

const STPATRICKS = '/seasons/stpatricks';

/** St Patrick's Day (hub-6pv.6.5): a rainbow ends at a pot of gold while two leprechauns dance a jig. */
const stpatricks: Sprite[] = [
	{
		id: 'rainbow',
		src: `${STPATRICKS}/rainbow.webp`,
		motion: 'glow',
		size: 24,
		x: { edge: 'right', vmin: 1 },
		y: { edge: 'bottom', pct: 3 },
		period: 14,
		delay: 0
	},
	{
		id: 'pot-of-gold',
		src: `${STPATRICKS}/pot-of-gold.webp`,
		motion: 'rest',
		size: 9,
		x: { edge: 'right', vmin: 2 },
		y: { edge: 'bottom', pct: 0.5 },
		period: 300,
		delay: 0
	},
	{
		id: 'shamrocks',
		src: `${STPATRICKS}/shamrocks.webp`,
		motion: 'rest',
		size: 6,
		x: { edge: 'right', vmin: 46 },
		y: { edge: 'bottom', pct: 0.5 },
		period: 260,
		delay: -80
	},
	{
		id: 'leprechaun-1',
		src: `${STPATRICKS}/leprechaun-step.webp`,
		flap: `${STPATRICKS}/leprechaun-kick.webp`,
		motion: 'rest',
		size: 11,
		x: { edge: 'right', vmin: 34 },
		y: { edge: 'bottom', pct: 0.5 },
		period: 7,
		delay: 0,
		flip: true
	},
	{
		id: 'leprechaun-2',
		src: `${STPATRICKS}/leprechaun-step.webp`,
		flap: `${STPATRICKS}/leprechaun-kick.webp`,
		motion: 'rest',
		size: 10,
		x: { edge: 'right', vmin: 53 },
		y: { edge: 'bottom', pct: 0.5 },
		period: 8,
		delay: -3
	}
];

const SPRITES: Partial<Record<Season, readonly Sprite[]>> = { halloween, christmasday, stpatricks };

/** The sprites a season shows; none for a plain day or a season without pictures yet. */
export function spritesFor(
	state: Pick<SeasonState, 'season' | 'reindeer' | 'christmasEve'>
): readonly Sprite[] {
	if (state.season === 'christmas') return state.christmasEve ? eve : herd(state.reindeer);
	return state.season ? (SPRITES[state.season] ?? []) : [];
}

/** Christmas Eve snows (drawn by the layer, not a picture). */
export const snowsOn = (state: Pick<SeasonState, 'christmasEve'>) => state.christmasEve;

/**
 * Sprites belong to the holiday look, so they show only when Auto lets the holiday take over,
 * the background is on for this device, and the photo frame isn't covering the screen.
 */
export function showSprites(o: {
	choice: WaveChoice;
	season: SeasonState;
	covered: boolean;
	deviceOff: boolean;
}): boolean {
	return o.choice === 'auto' && !o.covered && !o.deviceOff && spritesFor(o.season).length > 0;
}

/** The inline position and timing for a sprite: anchored to its edges, sized in vmin. */
export function spriteStyle(s: Sprite): string {
	return [
		`${s.x.edge}: ${s.x.vmin}vmin`,
		`${s.y.edge}: ${s.y.pct}%`,
		`height: ${s.size}vmin`,
		`--period: ${s.period}s`,
		`--delay: ${s.delay}s`
	].join('; ');
}

interface Box {
	top: number;
	bottom: number;
	width: number;
	height: number;
}

/**
 * How far the sprite layer keeps clear of the nav when it's a bar across the screen (hub-6pv.6.8):
 * the bottom tab bar in portrait, or the phone's top bar in landscape. A side rail needs nothing,
 * since resting sprites already stay on the right. Pixels, clamped to the viewport.
 */
export function navClearance(
	nav: Box | null,
	viewportHeight: number
): { top: number; bottom: number } {
	const none = { top: 0, bottom: 0 };
	if (!nav || nav.width <= nav.height || nav.height <= 0) return none;
	if (nav.bottom <= 0 || nav.top >= viewportHeight) return none;
	return nav.top + nav.height / 2 > viewportHeight / 2
		? { top: 0, bottom: Math.round(viewportHeight - Math.max(0, nav.top)) }
		: { top: Math.round(Math.min(viewportHeight, nav.bottom)), bottom: 0 };
}
