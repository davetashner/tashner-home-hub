/**
 * Shape helpers for the prompt starters' line art (hub-585), in the coloring pages' 1000 x 700
 * page space. Pure.
 */
import type { PathCmd } from '../drawing.js';

export type Path = PathCmd[];
export type Pt = [number, number];

/** An open line through the points. */
export const open = (...pts: Pt[]): Path => [
	['M', ...pts[0]],
	...pts.slice(1).map((p): PathCmd => ['L', ...p])
];
/** A closed outline through the points. */
export const poly = (...pts: Pt[]): Path => [...open(...pts), ['Z']];
export const rect = (x: number, y: number, w: number, h: number): Path =>
	poly([x, y], [x + w, y], [x + w, y + h], [x, y + h]);
export const oval = (x: number, y: number, rx: number, ry: number): Path => [['E', x, y, rx, ry]];
export const circle = (x: number, y: number, r: number): Path => oval(x, y, r, r);
/** A smooth hump from (x0, y) to (x1, y) peaking `rise` above it. */
export const hump = (x0: number, x1: number, y: number, rise: number): Path => [
	['M', x0, y],
	['C', x0 + (x1 - x0) * 0.2, y - rise * 1.3, x1 - (x1 - x0) * 0.2, y - rise * 1.3, x1, y]
];
