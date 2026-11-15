/**
 * Tap to animate (hub-t27j.5): lasso some ink and give it a motion (swim, fly, bounce, launch).
 * The ink loops across the board while the sheet paints it with a per-frame transform; the stored
 * points never change. A motion lives on each stroke as `motion: { kind, group }`: strokes that
 * share a group move together as one body, and separate groups each have their own motion.
 * Pure: curves are functions of time, nothing here touches a canvas or the clock.
 */
import type { Stroke } from './drawing.js';
import { inkBounds } from './drawing-lasso.js';

export const MOTIONS = ['swim', 'fly', 'bounce', 'launch'] as const;
export type MotionKind = (typeof MOTIONS)[number];

export interface Motion {
	kind: MotionKind;
	/** Strokes with the same group id move as one. */
	group: number;
}

export const isMotionKind = (v: unknown): v is MotionKind =>
	typeof v === 'string' && (MOTIONS as readonly string[]).includes(v);

/** Seconds one loop of each motion takes. */
export const PERIOD: Record<MotionKind, number> = { swim: 6, fly: 5, bounce: 1.2, launch: 3 };
/** Seconds each group is shifted from the last, so several groups do not move in lockstep. */
export const PHASE_STEP = 0.7;
export const MAX_GROUP = 999;

export interface Offset {
	dx: number;
	dy: number;
	/** Radians, about the group's centre. */
	rot: number;
}

const TAU = Math.PI * 2;
const STILL: Offset = { dx: 0, dy: 0, rot: 0 };
const easeOut = (u: number) => 1 - (1 - u) * (1 - u);
const easeInOut = (u: number) => (u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u));

/**
 * Where a motion has carried the ink `t` seconds in, for a board of `size`. Every curve is zero
 * at the start of a loop and joins up at its end, so the loop never jumps.
 */
export function motionAt(
	kind: MotionKind,
	t: number,
	size: { w: number; h: number },
	phase = 0
): Offset {
	if (!isMotionKind(kind) || !Number.isFinite(t) || !(size.w > 0) || !(size.h > 0)) return STILL;
	const T = PERIOD[kind];
	const u = ((((t + (Number.isFinite(phase) ? phase : 0)) / T) % 1) + 1) % 1;
	const { w, h } = size;
	switch (kind) {
		case 'swim': // drift out and back, wiggling like a tail
			return {
				dx: w * 0.2 * Math.sin(u * TAU),
				dy: h * 0.02 * Math.sin(u * TAU * 4),
				rot: 0.1 * Math.sin(u * TAU * 4)
			};
		case 'fly': // rise, bob, settle
			return {
				dx: w * 0.04 * Math.sin(u * TAU),
				dy: -h * 0.1 * (0.5 - 0.5 * Math.cos(u * TAU)) - h * 0.015 * Math.sin(u * TAU * 3),
				rot: 0.06 * Math.sin(u * TAU * 3)
			};
		case 'bounce': // a hop
			return { dx: 0, dy: -h * 0.14 * Math.abs(Math.sin(u * Math.PI)), rot: 0 };
		case 'launch': {
			// Shoot up fast, then float back down.
			const up = 0.35;
			const k = u < up ? easeOut(u / up) : 1 - easeInOut((u - up) / (1 - up));
			return { dx: 0, dy: -h * 0.5 * k, rot: 0.12 * Math.sin(k * Math.PI) };
		}
	}
}

/** Strokes that carry a motion. */
export const isAnimated = (s: unknown): s is Stroke & { motion: Motion } =>
	!!s && typeof s === 'object' && 'motion' in s && !!(s as Stroke).motion;

/** True when any item has a motion: the only time the sheet needs an animation loop. */
export const hasMotion = (items: readonly unknown[]): boolean => items.some(isAnimated);

/** The next unused group id. */
export function nextGroup(items: readonly unknown[]): number {
	let top = 0;
	for (const it of items) if (isAnimated(it)) top = Math.max(top, it.motion.group);
	return Math.min(top + 1, MAX_GROUP);
}

/** Copies of `items` with `kind` set on the strokes at `idx`, all in one new group. Others are shared as they were. */
export function setMotion<T>(items: readonly T[], idx: readonly number[], kind: MotionKind): T[] {
	const group = nextGroup(items);
	const pick = new Set(idx);
	return items.map((it, i) =>
		pick.has(i) && it && typeof it === 'object' && 'points' in it
			? { ...it, motion: { kind, group } }
			: it
	);
}

/** Copies with the motion taken off the strokes at `idx` (every stroke when `idx` is omitted). */
export function stopMotion<T>(items: readonly T[], idx?: readonly number[]): T[] {
	const pick = idx ? new Set(idx) : null;
	return items.map((it, i) => {
		if (!isAnimated(it) || (pick && !pick.has(i))) return it;
		return stripMotion(it as Stroke) as T;
	});
}

/** A copy of the stroke without its motion (a lasso copy starts still). */
export function stripMotion<S extends Stroke>(s: S): S {
	const out = { ...s };
	delete out.motion;
	return out;
}

/** The turning point of each group: the middle of its strokes' bounds. Keyed by group id. */
export function groupCentres(items: readonly unknown[]): Map<number, { x: number; y: number }> {
	const by = new Map<number, Stroke[]>();
	for (const it of items)
		if (isAnimated(it)) by.set(it.motion.group, [...(by.get(it.motion.group) ?? []), it]);
	const out = new Map<number, { x: number; y: number }>();
	for (const [g, list] of by) {
		const b = inkBounds(list);
		if (b) out.set(g, { x: b.x + b.w / 2, y: b.y + b.h / 2 });
	}
	return out;
}

/** Saved form of a motion: `[kind, group]`. */
export type MotionWire = [MotionKind, number];

export const motionWire = (m: Motion): MotionWire => [m.kind, m.group];

/** A motion from its saved form, or undefined when it is malformed (the stroke then just loads still). */
export function parseMotionWire(v: unknown): Motion | undefined {
	if (!Array.isArray(v) || v.length !== 2) return undefined;
	const [kind, group] = v;
	if (!isMotionKind(kind) || !Number.isInteger(group) || group < 1 || group > MAX_GROUP)
		return undefined;
	return { kind, group };
}
