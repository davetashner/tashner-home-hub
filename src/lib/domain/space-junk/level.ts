/**
 * Space Junk (hub-26w.1): the level format and its validation. Units are metres with y up and
 * the ground at y = 0; the slingshot sits on the left and the targets to its right. Levels are
 * plain JSON so they can ship as data now and come from a kid's editor later.
 */
import { MATERIALS, type MaterialId } from './materials.js';

export const MAX_LEVEL_WIDTH = 80;
export const MAX_LEVEL_HEIGHT = 40;
export const MAX_BLOCKS = 200;
export const MAX_GREMLINS = 20;
export const MAX_JUNKBOTS = 8;
/** Smallest and largest block or Gremlin dimension (half-extent or radius), in metres. */
export const MIN_SIZE = 0.1;
export const MAX_SIZE = 10;

export interface Point {
	x: number;
	y: number;
}

export interface BoxBlock {
	material: MaterialId;
	shape: 'box';
	x: number;
	y: number;
	/** Full width and height. */
	w: number;
	h: number;
	/** Radians, counter-clockwise. */
	angle: number;
}

export interface BallBlock {
	material: MaterialId;
	shape: 'ball';
	x: number;
	y: number;
	r: number;
}

export type Block = BoxBlock | BallBlock;

export interface Gremlin {
	x: number;
	y: number;
	r: number;
}

export interface Level {
	id: string;
	name: string;
	width: number;
	height: number;
	/** Where the pouch rests; Junkbots launch from here. */
	anchor: Point;
	junkbots: number;
	blocks: Block[];
	gremlins: Gremlin[];
}

export type LevelResult = { ok: true; level: Level } | { ok: false; error: string };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isSize = (v: unknown): v is number => isNum(v) && v >= MIN_SIZE && v <= MAX_SIZE;

class LevelError extends Error {}
function need(cond: boolean, msg: string): asserts cond {
	if (!cond) throw new LevelError(msg);
}

function point(v: unknown, what: string, width: number, height: number): Point {
	need(isObj(v) && isNum(v.x) && isNum(v.y), `${what} needs numeric x and y`);
	need(v.x >= 0 && v.x <= width && v.y >= 0 && v.y <= height, `${what} is outside the level`);
	return { x: v.x, y: v.y };
}

function block(v: unknown, i: number, width: number, height: number): Block {
	const what = `block ${i}`;
	need(isObj(v), `${what} is not an object`);
	const material = v.material;
	need(
		typeof material === 'string' && Object.hasOwn(MATERIALS, material),
		`${what} has an unknown material`
	);
	const { x, y } = point(v, what, width, height);
	if (v.shape === 'ball') {
		need(isSize(v.r), `${what} has a bad radius`);
		return { material: material as MaterialId, shape: 'ball', x, y, r: v.r };
	}
	need(v.shape === 'box', `${what} has an unknown shape`);
	need(isSize(v.w) && isSize(v.h), `${what} has a bad size`);
	need(v.angle === undefined || isNum(v.angle), `${what} has a bad angle`);
	return {
		material: material as MaterialId,
		shape: 'box',
		x,
		y,
		w: v.w,
		h: v.h,
		angle: v.angle ?? 0
	};
}

function gremlin(v: unknown, i: number, width: number, height: number): Gremlin {
	const what = `gremlin ${i}`;
	const { x, y } = point(v, what, width, height);
	need(isSize((v as Obj).r), `${what} has a bad radius`);
	return { x, y, r: (v as Obj).r as number };
}

/** Validates untrusted level JSON. Never throws. */
export function parseLevel(v: unknown): LevelResult {
	try {
		need(isObj(v), 'level is not an object');
		need(
			typeof v.id === 'string' && /^[a-z0-9-]{1,40}$/.test(v.id),
			'level id must be 1-40 of a-z, 0-9, -'
		);
		need(
			typeof v.name === 'string' && v.name.trim().length > 0 && v.name.length <= 40,
			'level needs a name'
		);
		const { width, height } = v;
		need(isNum(width) && width >= 10 && width <= MAX_LEVEL_WIDTH, 'level width is out of range');
		need(
			isNum(height) && height >= 10 && height <= MAX_LEVEL_HEIGHT,
			'level height is out of range'
		);
		need(
			Number.isInteger(v.junkbots) &&
				(v.junkbots as number) >= 1 &&
				(v.junkbots as number) <= MAX_JUNKBOTS,
			'junkbots must be 1-8'
		);
		need(
			Array.isArray(v.blocks) && v.blocks.length <= MAX_BLOCKS,
			'blocks must be a list of at most 200'
		);
		need(
			Array.isArray(v.gremlins) && v.gremlins.length >= 1 && v.gremlins.length <= MAX_GREMLINS,
			'a level needs 1-20 gremlins'
		);
		return {
			ok: true,
			level: {
				id: v.id,
				name: v.name.trim(),
				width,
				height,
				anchor: point(v.anchor, 'anchor', width, height),
				junkbots: v.junkbots as number,
				blocks: v.blocks.map((b, i) => block(b, i, width, height)),
				gremlins: v.gremlins.map((g, i) => gremlin(g, i, width, height))
			}
		};
	} catch (e) {
		if (e instanceof LevelError) return { ok: false, error: e.message };
		throw e;
	}
}
